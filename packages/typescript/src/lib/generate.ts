import { template } from 'lodash-es';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import { camelcase, spinalcase } from 'stringcase';

import { type OpenAPIDocument, pascalcase, toLitObject } from '@sdk-it/core';
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
import backend from './client.ts';
import { TypeScriptEmitter } from './emitters/interface.ts';
import { indexFiles } from './folder-index.ts';
import { generateCode } from './generator.ts';
import dispatcherTxt from './http/dispatcher.txt';
import interceptors from './http/interceptors.txt';
import parseResponse from './http/parse-response.txt';
import parserTxt from './http/parser.txt';
import requestTxt from './http/request.txt';
import responseTxt from './http/response.txt';
import sseTxt from './http/sse.txt';
import { type MakeImportFn } from './import-utilities.ts';
import { type ModelNamer, createModelNamer } from './model-name.ts';
import { moduleFileName } from './module-file.ts';
import type { TypeScriptGeneratorOptions } from './options.ts';
import cursorPaginationTxt from './paginations/cursor-pagination.txt';
import offsetPaginationTxt from './paginations/offset-pagination.txt';
import paginationTxt from './paginations/page-pagination.txt';
import { toReadme } from './readme/readme.ts';
import type { Operation } from './sdk.ts';
import security from './security.ts';
import { expandServerUrls } from './server-urls.ts';
import type { Style } from './style.ts';
import { TypeScriptSnippet } from './typescript-snippet.ts';

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

export async function generate(
  openapi: OpenAPIDocument,
  settings: TypeScriptGeneratorOptions,
): Promise<{ packageName: string }> {
  const options: RenderOptions = {
    name: settings.name || 'client',
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
    (settings.name
      ? `@${spinalcase(settings.name.trim().toLowerCase())}/sdk`
      : 'sdk');
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
              zod: '^4.3.0',
              ...(settings.agentTools === 'ai-sdk' ? { ai: '^7.0.29' } : {}),
              ...(settings.agentTools === 'openai-agents'
                ? { '@openai/agents': '^0.13.4' }
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

async function toSdkIR(openapi: OpenAPIDocument, options: RenderOptions) {
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
    'http/parse-response.ts': parseResponse,
    'http/response.ts': responseTxt,
    'http/parser.ts': parserTxt,
    'http/request.ts': requestTxt,
    'http/sse.ts': sseTxt,
    'http/dispatcher.ts': `import { z } from 'zod';
import { type Interceptor } from '${makeImport('../http/interceptors')}';
import { type RequestConfig } from '${makeImport('../http/request')}';
import { buffered } from '${makeImport('./parse-response')}';
import { type SSEListener } from '${makeImport('./sse')}';
import { APIError, APIResponse, type SuccessfulResponse, type RebindSuccessPayload } from '${makeImport('./response')}';

${template(dispatcherTxt, {})()}`,

    'http/interceptors.ts': `
    import type { RequestConfig, HeadersInit } from './${makeImport('request')}';
    ${interceptors}`,
    ...(Object.keys(spec.components.securitySchemes).length
      ? {
          'http/security.ts': security({
            makeImport,
            securitySchemes: spec.components.securitySchemes,
          }),
        }
      : {}),
    'client.ts': backend({
      name: clientName,
      servers: expandServerUrls(spec.servers ?? []),
      securitySchemes: spec.components.securitySchemes,
      makeImport,
    }),
    ...toInputs(groups, commonZod, makeImport),
    ...endpoints,
    ...serializeModels(spec, modelName),
    'pagination/cursor-pagination.ts': cursorPaginationTxt,
    'pagination/offset-pagination.ts': offsetPaginationTxt,
    'pagination/page-pagination.ts': paginationTxt,
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

function serializeModels(spec: IR, modelName: ModelNamer) {
  const filesMap: Record<string, string[]> = {};
  const files: Record<string, string> = {};
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
      typeContent = 'SSEListener';
    } else if (body === 'stream') {
      typeContent = 'ReadableStream';
    } else {
      typeContent = new TypeScriptEmitter(spec, modelName).handle(schema, true);
    }

    const imports: string[] = [];
    if (body === 'sse') {
      imports.push(`import type { SSEListener } from '../http/sse.ts';`);
    }

    const fileContent = [
      ...imports,
      `\n${schema.description ? `\n/** \n * ${schema.description}\n */\n` : ''}`,
      `export type ${modelName(name)} = ${typeContent};`,
    ];
    const fileName = responseGroup
      ? join(folder, `${moduleFileName(responseGroup)}.ts`)
      : join(folder, `${moduleFileName(name)}.ts`);
    filesMap[fileName] ??= [];
    filesMap[fileName].push(fileContent.join('\n'));
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

export function toInputs(
  operationsSet: Record<string, Operation[]>,
  commonZod: Map<string, string>,
  makeImport: MakeImportFn,
) {
  const commonImports = commonZod.keys().toArray();
  const inputs: Record<string, string> = {};
  for (const [name, operations] of Object.entries(operationsSet)) {
    const output: string[] = [];
    const imports = new Set(['import { z } from "zod";']);

    for (const operation of operations) {
      const schemaName = camelcase(`${operation.operationId} schema`);

      const schema = `export const ${schemaName} = ${
        Object.keys(operation.schemas).length === 1
          ? Object.values(operation.schemas)[0]
          : toLitObject(operation.schemas)
      };`;

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
