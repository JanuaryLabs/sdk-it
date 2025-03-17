import { join } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { getFolderExports, methods, writeFiles } from '@sdk-it/core';

import { generateCode } from './generator.ts';
import interceptors from './http/interceptors.txt';
import parseResponse from './http/parse-response.txt';
import parserTxt from './http/parser.txt';
import requestTxt from './http/request.txt';
import responseTxt from './http/response.txt';
import sendRequest from './http/send-request.txt';
import { generateInputs, generateSDK } from './sdk.ts';
import { exclude, securityToOptions } from './utils.ts';

function security(spec: OpenAPIObject) {
  const security = spec.security || [];
  const components = spec.components || {};
  const securitySchemes = components.securitySchemes || {};
  const paths = Object.values(spec.paths ?? {});

  const options = securityToOptions(security, securitySchemes);

  for (const it of paths) {
    for (const method of methods) {
      const operation = it[method];
      if (!operation) {
        continue;
      }
      Object.assign(
        options,
        securityToOptions(operation.security || [], securitySchemes, 'input'),
      );
    }
  }
  return options;
}

export async function generate(
  spec: OpenAPIObject,
  settings: {
    output: string;
    useTsExtension?: boolean;
    name?: string;
    /**
     * full: generate a full project including package.json and tsconfig.json. useful for monorepo/workspaces
     * minimal: generate only the client sdk
     */
    mode?: 'full' | 'minimal';
    formatCode?: (options: {
      output: string;
      env: ReturnType<typeof npmRunPathEnv>;
    }) => void | Promise<void>;
  },
) {
  settings.useTsExtension ??= true;
  const makeImport = (moduleSpecifier: string) => {
    return settings.useTsExtension ? `${moduleSpecifier}.ts` : moduleSpecifier;
  };
  const { commonSchemas, groups, outputs, commonZod } = generateCode({
    spec,
    style: 'github',
    target: 'javascript',
    makeImport,
  });
  const output =
    settings.mode === 'full' ? join(settings.output, 'src') : settings.output;

  const options = security(spec);

  const clientFiles = generateSDK({
    name: settings.name || 'Client',
    operations: groups,
    servers: spec.servers?.map((server) => server.url) || [],
    options: options,
    makeImport,
  });

  // const readme = generateReadme(spec, {
  //   name: settings.name || 'Client',
  // });

  const inputFiles = generateInputs(groups, commonZod, makeImport);

  await writeFiles(output, {
    'outputs/.gitkeep': '',
    'inputs/.gitkeep': '',
    'models/.getkeep': '',
    // 'README.md': readme,
  });

  await writeFiles(join(output, 'http'), {
    'interceptors.ts': interceptors,
    'parse-response.ts': parseResponse,
    'send-request.ts': `import z from 'zod';
import type { Interceptor } from './${makeImport('interceptors')}';
import { handleError } from './${makeImport('parse-response')}';
import { parse } from './${makeImport('parser')}';
${sendRequest}`,
    'response.ts': responseTxt,
    'parser.ts': parserTxt,
    'request.ts': requestTxt,
  });

  await writeFiles(join(output, 'outputs'), outputs);
  const modelsImports = Object.entries(commonSchemas).map(([name]) => name);
  await writeFiles(output, {
    ...clientFiles,
    ...inputFiles,
    ...Object.fromEntries(
      Object.entries(commonSchemas).map(([name, schema]) => [
        `models/${name}.ts`,
        [
          `import { z } from 'zod';`,
          ...exclude(modelsImports, [name]).map(
            (it) => `import type { ${it} } from './${it}.ts';`,
          ),
          `export type ${name} = ${schema};`,
        ].join('\n'),
      ]),
    ),
  });

  const folders = [
    getFolderExports(join(output, 'outputs'), settings.useTsExtension),
    getFolderExports(
      join(output, 'inputs'),
      settings.useTsExtension,
      ['ts'],
      (dirent) => dirent.isDirectory() && dirent.name === 'schemas',
    ),
    getFolderExports(join(output, 'http'), settings.useTsExtension),
  ];
  if (modelsImports.length) {
    folders.push(
      getFolderExports(join(output, 'models'), settings.useTsExtension),
    );
  }
  const [outputIndex, inputsIndex, httpIndex, modelsIndex] =
    await Promise.all(folders);
  await writeFiles(output, {
    'outputs/index.ts': outputIndex,
    'inputs/index.ts': inputsIndex || null,
    'http/index.ts': httpIndex,
    ...(modelsImports.length ? { 'models/index.ts': modelsIndex } : {}),
  });
  await writeFiles(output, {
    'index.ts': await getFolderExports(output, settings.useTsExtension),
  });
  if (settings.mode === 'full') {
    await writeFiles(settings.output, {
      'package.json': {
        ignoreIfExists: true,
        content: JSON.stringify(
          {
            name: 'sdk',
            type: 'module',
            main: './src/index.ts',
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
    });
  }

  await settings.formatCode?.({
    output: output,
    env: npmRunPathEnv(),
  });
}
