import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import runtimeSources from 'runtime-sources';
import { spinalcase } from 'stringcase';

import {
  type OpenAPIDocument,
  isRef,
  parseRef,
  pascalcase,
  pointerTokens,
  valueAtPointer,
} from '@sdk-it/core';
import {
  type WriteContent,
  addLeadingSlash,
  readFolder,
  writeFiles,
} from '@sdk-it/core/file-system.js';
import {
  type IR,
  type PaginationConfig,
  type ResponseBody,
  cleanFiles,
  forEachOperation,
  readWriteMetadata,
  toIR,
} from '@sdk-it/spec';

import { generateAISDKTools } from './agent/ai-sdk.ts';
import { generateOpenAIAgentTools } from './agent/openai-agents.ts';
import utilsTxt from './agent/utils.txt';
import backend, {
  clientDeclarations,
  clientDeclaredNames,
  clientRuntimeExports,
  clientRuntimeTypeExports,
} from './client.ts';
import { TypeScriptEmitter } from './emitters/interface.ts';
import { indexFiles } from './folder-index.ts';
import { generateCode, operationFragments } from './generator.ts';
import { type MakeImportFn } from './import-utilities.ts';
import { type ModelNamer, createModelNamer } from './model-name.ts';
import { moduleFileName } from './module-file.ts';
import {
  type ModuleSpan,
  assembleModule,
  moduleReferences,
} from './one-module.ts';
import type { TypeScriptGeneratorOptions } from './options.ts';
import { toReadme } from './readme/readme.ts';
import { type References, fileReferences } from './references.ts';
import type { Operation } from './sdk.ts';
import { expandServerUrls } from './server-urls.ts';
import type { Style } from './style.ts';
import { TypeScriptSnippet } from './typescript-snippet.ts';

export type { ModuleSpan } from './one-module.ts';

export interface RenderOptions {
  name: string;
  style: Style;
  useTsExtension: boolean;
  pagination?: PaginationConfig | false;
  agentTools?: 'ai-sdk' | 'openai-agents';
}

/**
 * The SDK's source files, keyed by path relative to the SDK source root,
 * index files included. Reads and writes nothing on disk.
 */
export async function render(
  openapi: OpenAPIDocument,
  options: RenderOptions,
): Promise<Record<string, string>> {
  return renderFiles(await toSdkIR(openapi, options), options);
}

export interface ModuleOptions {
  name: string;
}

/**
 * The SDK as one TypeScript module that carries the runtime source, for hosts
 * that load a spec as a module (a content mapper, a bundler plugin, a loader).
 * It exports what the SDK root of `render()` exports. `spans` maps the names
 * the module declares to where the document declares them. Reads and writes
 * nothing on disk.
 */
export async function renderModule(
  openapi: OpenAPIDocument,
  options: ModuleOptions,
): Promise<{ text: string; spans: ModuleSpan[] }> {
  const spec = await toSdkIR(openapi, {});
  const name = pascalcase(options.name.trim());
  const modelName = createModelNamer(name);
  const { groups, commonZod, endpoints } = operationFragments({
    spec,
    modelName,
    zodRefs: moduleReferences,
    endpointRefs: moduleReferences,
  });
  const client = {
    name,
    servers: expandServerUrls(spec.servers),
    securitySchemes: spec.components.securitySchemes,
  };
  const bodies = inlineBodyLocations(spec);
  const { text, spans } = assembleModule({
    commonZod,
    inputs: Object.values(groups)
      .flat()
      .flatMap((operation) =>
        operation.inputs.map(({ schemaName, zod }) => ({
          name: schemaName,
          zod,
        })),
      ),
    models: modelDeclarations(spec, modelName, moduleReferences).map(
      ({ schemaName, inline, typeName, doc, type }) => ({
        typeName,
        doc,
        type,
        location: inline
          ? bodies.get(schemaName)
          : ['components', 'schemas', schemaName],
      }),
    ),
    endpoints: Object.values(endpoints).flat(),
    client: clientDeclarations(client, moduleReferences, '__routes'),
    clientNames: clientDeclaredNames(name),
    runtimeExports: clientRuntimeExports,
    runtimeTypeExports: clientRuntimeTypeExports(client),
  });
  return {
    text,
    spans: spans.flatMap((span) => {
      const location = documentLocation(openapi, span.location);
      return location ? [{ ...span, location }] : [];
    }),
  };
}

/**
 * Where the document the caller passed holds what `location` names in the IR.
 * The walk follows each `$ref` it meets as a pointer into this document, so
 * the body of a referenced response is where the reference points. Undefined
 * where the document has nothing there: spec made it up (a success response
 * for an operation without one), rewrote its key (a `:id` path), or a
 * reference leads to another document.
 */
function documentLocation(document: unknown, location: readonly string[]) {
  let current = document;
  let path: readonly string[] = [];
  for (const token of location) {
    while (isRef(current)) {
      path = pointerTokens(current.$ref.slice(1));
      current = valueAtPointer(document, path);
    }
    if (!hasMember(current, token)) {
      return undefined;
    }
    current = Reflect.get(current, token);
    path = [...path, token];
  }
  return path;
}

function hasMember(value: unknown, token: string): value is object {
  return typeof value === 'object' && value !== null && token in value;
}

/**
 * The response body that references each schema. Spec replaces an inline body
 * with a reference to the schema it makes from it, so for such a schema this is
 * where its body sat in the document.
 */
function inlineBodyLocations(spec: IR) {
  const locations = new Map<string, readonly string[]>();
  forEachOperation(spec, (entry, operation) => {
    for (const [status, response] of Object.entries(operation.responses)) {
      for (const [type, media] of Object.entries(response.content)) {
        if (isRef(media.schema)) {
          locations.set(parseRef(media.schema.$ref).model, [
            'paths',
            entry.path,
            entry.method,
            'responses',
            status,
            'content',
            type,
            'schema',
          ]);
        }
      }
    }
  });
  return locations;
}

export async function generate(
  openapi: OpenAPIDocument,
  settings: TypeScriptGeneratorOptions,
): Promise<{ packageName: string }> {
  const options: RenderOptions = {
    name: settings.name,
    style: { name: 'github', ...settings.style },
    useTsExtension: settings.useTsExtension ?? true,
    pagination: settings.pagination,
    agentTools: settings.agentTools,
  };
  const spec = await toSdkIR(openapi, options);
  const files = renderFiles(spec, options);
  const output =
    settings.mode === 'full' ? join(settings.output, 'src') : settings.output;
  const writer = settings.writer ?? writeFiles;
  await writer(output, files);

  const metadata = await readWriteMetadata(
    output,
    Object.keys(files).map(addLeadingSlash),
    writer,
  );
  if (settings.cleanup !== false) {
    await cleanFiles(metadata, output, [
      '/tsconfig*.json',
      '/package.json',
      '/metadata.json',
      '/**/index.ts',
    ]);
  }

  // Index files also export what the output folder holds beyond this run's
  // files: files a user added, and stale files when cleanup is off.
  const listed = await readFolder(output, true);
  const userIndexes = new Map(
    await Promise.all(
      listed
        .filter((path) => path.endsWith('/index.ts') && !(path in files))
        .map(
          async (path) =>
            [path, await readFile(join(output, path), 'utf-8')] as const,
        ),
    ),
  );
  const indexes = indexFiles(
    new Set([...Object.keys(files), ...listed]),
    (path) => files[path] ?? userIndexes.get(path),
    options.useTsExtension,
  );
  const changedIndexes = Object.fromEntries(
    Object.entries(indexes).filter(
      ([path, content]) => files[path] !== content,
    ),
  );
  if (Object.keys(changedIndexes).length) {
    await writer(output, changedIndexes);
  }

  const packageName =
    settings.packageName ??
    `@${spinalcase(settings.name.trim().toLowerCase())}/sdk`;
  if (settings.mode === 'full') {
    const configFiles: WriteContent = {
      'package.json': {
        ignoreIfExists: true,
        content: JSON.stringify(
          {
            name: packageName,
            version: '0.0.1',
            type: 'module',
            main: './src/index.ts',
            module: './src/index.ts',
            types: './src/index.ts',
            publishConfig: {
              access: 'public',
            },
            exports: {
              './package.json': './package.json',
              '.': {
                types: './src/index.ts',
                import: './src/index.ts',
                default: './src/index.ts',
              },
            },
            dependencies: {
              'fast-content-type-parse': '^3.0.0',
              zod: '^4.6.7',
              ...(settings.agentTools === 'ai-sdk' ? { ai: '^7.0.29' } : {}),
              ...(settings.agentTools === 'openai-agents'
                ? { '@openai/agents': '^0.21.0' }
                : {}),
            },
          },
          null,
          2,
        ),
      },
      'tsconfig.json': {
        ignoreIfExists: true,
        content: JSON.stringify(
          {
            compilerOptions: {
              skipLibCheck: true,
              skipDefaultLibCheck: true,
              target: 'ESNext',
              noEmit: true,
              allowImportingTsExtensions: true,
              verbatimModuleSyntax: true,
              moduleResolution: 'bundler',
            },
            include: ['**/*.ts'],
          },
          null,
          2,
        ),
      },
    };
    await writer(settings.output, configFiles);
  }

  const readme = settings.readme ?? true;
  if (readme) {
    const path = typeof readme === 'string' ? readme : 'README.md';
    await writer(settings.output, {
      [path]: toReadme(spec, new TypeScriptSnippet(spec, settings)),
    });
  }

  await settings.formatCode?.({
    output: output,
    env: npmRunPathEnv(),
  });

  return { packageName };
}

async function toSdkIR(
  openapi: OpenAPIDocument,
  options: Pick<RenderOptions, 'pagination'>,
) {
  // A requirement with no local scheme leaves the client unable to authenticate,
  // so refuse rather than emit an SDK that always gets a 401.
  const unresolvedSecuritySchemes = new Set<string>();
  const spec = await toIR(
    {
      spec: openapi,
      responses: { flattenErrorResponses: true },
      pagination: options.pagination,
      onDiagnostic: ({ code, message }) => {
        if (code === 'unresolved-security-scheme') {
          unresolvedSecuritySchemes.add(message);
        }
      },
    },
    false,
  );
  if (unresolvedSecuritySchemes.size) {
    throw new TypeError([...unresolvedSecuritySchemes].join('\n'));
  }
  return spec;
}

const agentTools = {
  'ai-sdk': generateAISDKTools,
  'openai-agents': generateOpenAIAgentTools,
};

/** Runtime files import their siblings as './x.ts'; the SDK's import style decides the extension. */
function withSdkImports(source: string, makeImport: MakeImportFn) {
  return source.replaceAll(
    /(from ')(\.\.?\/[^']+)\.ts(')/g,
    (_, from: string, path: string, quote: string) =>
      `${from}${makeImport(path)}${quote}`,
  );
}

function renderFiles(spec: IR, options: RenderOptions) {
  const { style, useTsExtension } = options;
  const makeImport = (moduleSpecifier: string) => {
    return useTsExtension ? `${moduleSpecifier}.ts` : moduleSpecifier;
  };
  const clientName = pascalcase(options.name.trim());
  const modelName = createModelNamer(clientName);
  const { endpoints, groups, commonZod } = generateCode({
    spec,
    style,
    makeImport,
    modelName,
  });

  const files: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(runtimeSources).map(([path, source]) => [
        path,
        withSdkImports(source, makeImport),
      ]),
    ),
    'client.ts': backend({
      name: clientName,
      servers: expandServerUrls(spec.servers ?? []),
      securitySchemes: spec.components.securitySchemes,
      makeImport,
    }),
    ...toInputs(groups, commonZod, makeImport),
    ...endpoints,
    ...serializeModels(spec, modelName),
    ...(options.agentTools
      ? {
          'agents.ts': `${agentTools[options.agentTools](spec, makeImport)}\n${utilsTxt}`,
        }
      : {}),
  };
  return {
    ...files,
    ...indexFiles(Object.keys(files), (path) => files[path], useTsExtension),
  };
}

/** A model type an SDK declares. */
interface ModelDeclaration {
  /** The key of its schema in the IR's `components.schemas`. */
  schemaName: string;
  /** Whether spec made the schema from an inline response body. */
  inline: boolean;
  typeName: string;
  /** The JSDoc that goes before the declaration, or ''. */
  doc: string;
  type: string;
  /** The file a multi-file SDK declares it in. */
  file: string;
  /** Whether `type` is the runtime's SSEListener. */
  sse: boolean;
}

function serializeModels(spec: IR, modelName: ModelNamer) {
  const filesMap: Record<string, string[]> = {};
  const files: Record<string, string> = {};
  for (const model of modelDeclarations(
    spec,
    modelName,
    fileReferences('models'),
  )) {
    const fileContent = [
      ...(model.sse
        ? [`import type { SSEListener } from '../http/sse.ts';`]
        : []),
      `\n${model.doc}`,
      `export type ${model.typeName} = ${model.type};`,
    ];
    filesMap[model.file] ??= [];
    filesMap[model.file].push(fileContent.join('\n'));
  }

  for (const [group, contents] of Object.entries(filesMap)) {
    let fileContent = contents.join('\n');
    if (fileContent.includes('models.')) {
      fileContent = `import type * as models from '../index.ts';\n${fileContent}`;
    }
    files[group] = fileContent;
  }
  return files;
}

function modelDeclarations(
  spec: IR,
  modelName: ModelNamer,
  refs: References,
): ModelDeclaration[] {
  const models: ModelDeclaration[] = [];
  const responseBodies = new Map<string, ResponseBody>();
  forEachOperation(spec, (_, operation) => {
    for (const response of Object.values(operation.responses)) {
      const name = response['x-response-name'];
      if (name) {
        responseBodies.set(name, response['x-body']);
      }
    }
  });
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    const isResponseBody =
      'x-responsebody' in schema && schema['x-responsebody'];
    const isRequestBody = 'x-requestbody' in schema && schema['x-requestbody'];
    const responseGroup =
      'x-response-group' in schema &&
      typeof schema['x-response-group'] === 'string'
        ? schema['x-response-group']
        : undefined;
    const body = responseGroup ? responseBodies.get(name) : undefined;
    if (isRequestBody) {
      // we do not generate interfaces for request bodies. we use zod for that.
      // bewary that the sometimes request body content schema is used as model somewhere else.
      // so we need to till the augmenter to create completeley separate model for request body suffixed by `Input`
      continue;
    }
    const folder = isResponseBody ? 'outputs' : 'models';
    let typeContent: string;
    if (body === 'sse') {
      typeContent = refs.runtime('SSEListener');
    } else if (body === 'stream') {
      typeContent = refs.global('ReadableStream');
    } else {
      typeContent = new TypeScriptEmitter(spec, modelName, refs).handle(
        schema,
        true,
      );
    }

    models.push({
      schemaName: name,
      inline: responseGroup !== undefined,
      typeName: modelName(name),
      doc: schema.description ? `\n/** \n * ${schema.description}\n */\n` : '',
      type: typeContent,
      file: responseGroup
        ? join(folder, `${moduleFileName(responseGroup)}.ts`)
        : join(folder, `${moduleFileName(name)}.ts`),
      sse: body === 'sse',
    });
  }
  return models;
}

function toInputs(
  operationsSet: Record<string, Operation[]>,
  commonZod: Map<string, string>,
  makeImport: MakeImportFn,
) {
  const commonImports = commonZod.keys().toArray();
  const inputs: Record<string, string> = {};
  for (const [name, operations] of Object.entries(operationsSet)) {
    const output: string[] = [];
    const imports = new Set(['import { z } from "zod";']);

    for (const route of operations.flatMap((operation) => operation.inputs)) {
      const schema = `export const ${route.schemaName} = ${route.zod};`;

      for (const it of commonImports) {
        if (schema.includes(it)) {
          imports.add(
            `import { ${it} } from './schemas/${makeImport(moduleFileName(it))}';`,
          );
        }
      }
      output.push(schema);
    }
    inputs[`inputs/${moduleFileName(name)}.ts`] =
      [...imports, ...output].join('\n') + '\n';
  }

  const schemas = commonZod
    .entries()
    .reduce<string[][]>((acc, [name, schema]) => {
      const output = [`import { z } from 'zod';`];
      const content = `export const ${name} = ${schema};`;
      if (content.includes('z.ZodType<models.')) {
        output.push(
          `import type * as models from '${makeImport('../../models/index')}';`,
        );
      }
      for (const schema of commonImports) {
        const preciseMatch = new RegExp(`\\b${schema}\\b`);
        if (preciseMatch.test(content) && schema !== name) {
          output.push(
            `import { ${schema} } from './${makeImport(moduleFileName(schema))}';`,
          );
        }
      }
      output.push(content);
      return [
        [`inputs/schemas/${moduleFileName(name)}.ts`, output.join('\n')],
        ...acc,
      ];
    }, []);

  return {
    ...Object.fromEntries(schemas),
    ...inputs,
  };
}
