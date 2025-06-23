import { template } from 'lodash-es';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { camelcase, spinalcase } from 'stringcase';

import { methods, pascalcase, toLitObject } from '@sdk-it/core';
import {
  type WriteContent,
  createWriterProxy,
  getFolderExports,
  writeFiles,
} from '@sdk-it/core/file-system.js';
import { toReadme } from '@sdk-it/readme';
import {
  type OurOpenAPIObject,
  augmentSpec,
  cleanFiles,
  readWriteMetadata,
  sanitizeTag,
} from '@sdk-it/spec';

import backend from './client.ts';
import { TypeScriptEmitter } from './emitters/interface.ts';
import { generateCode } from './generator.ts';
import dispatcherTxt from './http/dispatcher.txt';
import interceptors from './http/interceptors.txt';
import parseResponse from './http/parse-response.txt';
import parserTxt from './http/parser.txt';
import requestTxt from './http/request.txt';
import responseTxt from './http/response.txt';
import type { TypeScriptGeneratorOptions } from './options.ts';
import cursorPaginationTxt from './paginations/cursor-pagination.txt';
import offsetPaginationTxt from './paginations/offset-pagination.txt';
import paginationTxt from './paginations/page-pagination.txt';
import type { Operation } from './sdk.ts';
import { TypeScriptGenerator } from './typescript-snippet.ts';
import { type MakeImportFn, securityToOptions } from './utils.ts';

function security(spec: OpenAPIObject) {
  const security = spec.security || [];
  const components = spec.components || {};
  const securitySchemes = components.securitySchemes || {};
  const paths = Object.values(spec.paths ?? {});

  const options = securityToOptions(spec, security, securitySchemes);

  for (const it of paths) {
    for (const method of methods) {
      const operation = it[method];
      if (!operation) {
        continue;
      }
      Object.assign(
        options,
        securityToOptions(
          spec,
          operation.security || [],
          securitySchemes,
          'input',
        ),
      );
    }
  }
  return options;
}

// FIXME: there should not be default here
// instead export this function from the cli package with
// defaults for programmatic usage
export async function generate(
  openapi: OpenAPIObject,
  settings: TypeScriptGeneratorOptions,
) {
  const spec = augmentSpec(
    { spec: openapi, responses: { flattenErrorResponses: true } },
    false,
  );

  const generator = new TypeScriptGenerator(spec, settings);
  const style = Object.assign(
    {},
    {
      errorAsValue: false,
      name: 'github',
      outputType: 'default',
    },
    settings.style ?? {},
  );
  const output =
    settings.mode === 'full' ? join(settings.output, 'src') : settings.output;

  settings.useTsExtension ??= true;
  const { writer, files: writtenFiles } = createWriterProxy(
    settings.writer ?? writeFiles,
    output,
  );
  settings.writer = writer;
  settings.readFolder ??= async (folder: string) => {
    const files = await readdir(folder, { withFileTypes: true });
    return files.map((file) => ({
      fileName: file.name,
      filePath: join(file.parentPath, file.name),
      isFolder: file.isDirectory(),
    }));
  };
  const makeImport = (moduleSpecifier: string) => {
    return settings.useTsExtension ? `${moduleSpecifier}.ts` : moduleSpecifier;
  };
  const { endpoints, groups, commonZod } = generateCode({
    spec,
    style,
    makeImport,
  });
  const options = security(spec);
  const clientName = pascalcase((settings.name || 'client').trim());

  const packageName = settings.name
    ? `@${spinalcase(settings.name.trim().toLowerCase())}/sdk`
    : 'sdk';

  const inputs = toInputs(groups, commonZod, makeImport);
  const models = serializeModels(spec);

  await settings.writer(output, {
    'outputs/.gitkeep': '',
    'inputs/.gitkeep': '',
    'models/.getkeep': '',
  });

  await settings.writer(join(output, 'http'), {
    'parse-response.ts': parseResponse,
    'response.ts': responseTxt,
    'parser.ts': parserTxt,
    'request.ts': requestTxt,
    'dispatcher.ts': `import z from 'zod';
import { type Interceptor } from '${makeImport('../http/interceptors')}';
import { type RequestConfig } from '${makeImport('../http/request')}';
import { buffered } from '${makeImport('./parse-response')}';
import { APIError, APIResponse, type SuccessfulResponse, type ProblematicResponse } from '${makeImport('./response')}';

${template(dispatcherTxt, {})({ throwError: !style.errorAsValue, outputType: style.outputType })}`,

    'interceptors.ts': `
    import type { RequestConfig, HeadersInit } from './${makeImport('request')}';
    ${interceptors}`,
  });

  await settings.writer(output, {
    'client.ts': backend(
      {
        name: clientName,
        servers: (spec.servers ?? []).map((server) => server.url) || [],
        options: options,
        makeImport,
      },
      style,
    ),
    ...inputs,
    ...endpoints,
  });

  await settings.writer(output, models);

  await settings.writer(join(output, 'pagination'), {
    'cursor-pagination.ts': cursorPaginationTxt,
    'offset-pagination.ts': offsetPaginationTxt,
    'page-pagination.ts': paginationTxt,
  });

  const metadata = await readWriteMetadata(output, Array.from(writtenFiles));
  if (settings.cleanup !== false && writtenFiles.size > 0) {
    await cleanFiles(metadata.content, output, [
      '/tsconfig*.json',
      '/package.json',
      '/metadata.json',
      '/**/index.ts',
    ]);
  }

  const folders = [
    getFolderExports(
      join(output, 'outputs'),
      settings.readFolder,
      settings.useTsExtension,
    ),
    getFolderExports(
      join(output, 'inputs'),
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
      (dirent) => dirent.isFolder && ['schemas'].includes(dirent.fileName),
    ),
    getFolderExports(
      join(output, 'api'),
      settings.readFolder,
      settings.useTsExtension,
    ),
    getFolderExports(
      join(output, 'http'),
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
      (dirent) => !['response.ts', 'parser.ts'].includes(dirent.fileName),
    ),
    getFolderExports(
      join(output, 'models'),
      settings.readFolder,
      settings.useTsExtension,
    ),
  ];
  const [outputIndex, inputsIndex, apiIndex, httpIndex, modelsIndex] =
    await Promise.all(folders);

  await settings.writer(join(output, 'pagination'), {
    'index.ts': await getFolderExports(
      join(output, 'pagination'),
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
    ),
  });
  await settings.writer(output, {
    'api/index.ts': apiIndex,
    'outputs/index.ts': outputIndex,
    'inputs/index.ts': inputsIndex || null,
    'http/index.ts': httpIndex,
    'models/index.ts': modelsIndex,
    // ...(modelsImports.length ? { 'models/index.ts': modelsIndex } : {}),
  });
  await settings.writer(output, {
    'index.ts': await getFolderExports(
      output,
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
      (config) => config.fileName.endsWith('pagination'),
    ),
  });
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
              zod: '^3.24.2',
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
              module: 'ESNext',
              noEmit: true,
              strict: true,
              allowImportingTsExtensions: true,
              verbatimModuleSyntax: true,
              baseUrl: '.',
              moduleResolution: 'bundler',
            },
            include: ['**/*.ts'],
          },
          null,
          2,
        ),
      },
    };
    if (settings.readme) {
      configFiles['README.md'] = {
        ignoreIfExists: false,
        content: toReadme(spec, {
          generateSnippet: (...args) => generator.snippet(...args),
        }),
      };
    }
    await settings.writer(settings.output, configFiles);
  }

  await settings.formatCode?.({
    output: output,
    env: npmRunPathEnv(),
  });
}

function serializeModels(spec: OurOpenAPIObject) {
  const filesMap: Record<string, string[]> = {};
  const files: Record<string, string> = {};
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    // if (isRef(schema)) {
    //  continue;
    // }
    const isResponseBody = (schema as any)['x-responsebody'];
    const isRequestBody = (schema as any)['x-requestbody'];
    const responseGroup = (schema as any)['x-response-group'];
    const stream = (schema as any)['x-stream'];
    if (isRequestBody) {
      // we do not generate interfaces for request bodies. we use zod for that.
      // bewary that the sometimes request body content schema is used as model somewhere else.
      // so we need to till the augmenter to create completeley separate model for request body suffixed by `Input`
      continue;
    }
    const folder = isResponseBody ? 'outputs' : 'models';
    let typeContent = 'ReadableStream';
    if (!stream) {
      const serializer = new TypeScriptEmitter(spec);
      typeContent = serializer.handle(schema, true);
    }

    const fileContent = [
      `\n${schema.description ? `\n/** \n * ${schema.description}\n */\n` : ''}`,
      `export type ${pascalcase(sanitizeTag(name))} = ${typeContent};`,
    ];
    const fileName = responseGroup
      ? join(folder, `${spinalcase(responseGroup)}.ts`)
      : join(folder, `${spinalcase(name)}.ts`);
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
      const schemaName = camelcase(`${operation.name} schema`);

      const schema = `export const ${schemaName} = ${
        Object.keys(operation.schemas).length === 1
          ? Object.values(operation.schemas)[0]
          : toLitObject(operation.schemas)
      };`;

      for (const it of commonImports) {
        if (schema.includes(it)) {
          imports.add(
            `import { ${it} } from './schemas/${makeImport(spinalcase(it))}';`,
          );
        }
      }
      output.push(schema);
    }
    inputs[`inputs/${spinalcase(name)}.ts`] =
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
            `import { ${schema} } from './${makeImport(spinalcase(schema))}';`,
          );
        }
      }
      output.push(content);
      return [
        [`inputs/schemas/${spinalcase(name)}.ts`, output.join('\n')],
        ...acc,
      ];
    }, []);

  return {
    ...Object.fromEntries(schemas),
    ...inputs,
  };
}
