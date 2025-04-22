import { template } from 'lodash-es';
import { join } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { spinalcase } from 'stringcase';

import { type WriteContent, getFolderExports, writeFiles } from '@sdk-it/core/file-system.js';

import backend from './client.ts';
import { generateCode } from './generator.ts';
import interceptors from './http/interceptors.txt';
import parseResponse from './http/parse-response.txt';
import parserTxt from './http/parser.txt';
import requestTxt from './http/request.txt';
import responseTxt from './http/response.txt';
import sendRequestTxt from './http/send-request.txt';
import { toReadme } from './readme.ts';
import { generateInputs } from './sdk.ts';
import type { Style } from './style.ts';
import { exclude, securityToOptions } from './utils.ts';
import { methods, pascalcase } from '@sdk-it/core';

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
    readme?: boolean;
    style?: Style;
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
  const style = Object.assign(
    {},
    {
      errorAsValue: true,
      name: 'github',
      outputType: 'default',
    },
    settings.style ?? {},
  );

  settings.useTsExtension ??= true;
  const makeImport = (moduleSpecifier: string) => {
    return settings.useTsExtension ? `${moduleSpecifier}.ts` : moduleSpecifier;
  };
  const { commonSchemas, endpoints, groups, outputs, commonZod } = generateCode(
    {
      spec,
      style,
      makeImport,
    },
  );
  const output =
    settings.mode === 'full' ? join(settings.output, 'src') : settings.output;
  const options = security(spec);
  const clientName = settings.name?.trim()
    ? pascalcase(settings.name)
    : 'Client';

  const readme = settings.readme ? toReadme(spec) : '';

  // FIXME: inputs, outputs should be generated before hand.
  const inputFiles = generateInputs(groups, commonZod, makeImport);

  console.log('Writing to', output);

  await writeFiles(output, {
    'outputs/.gitkeep': '',
    'inputs/.gitkeep': '',
    'models/.getkeep': '',
  });

  await writeFiles(join(output, 'http'), {
    'interceptors.ts': `
    import type { RequestConfig, HeadersInit } from './${makeImport('request')}';
    ${interceptors}`,
    'parse-response.ts': parseResponse,
    'send-request.ts': `import z from 'zod';
import type { Interceptor } from './${makeImport('interceptors')}';
import { buffered } from './${makeImport('parse-response')}';
import { parseInput } from './${makeImport('parser')}';
import type { RequestConfig } from './${makeImport('request')}';
import { APIError, APIResponse } from './${makeImport('response')}';

${template(sendRequestTxt, {})({ throwError: !style.errorAsValue, outputType: style.outputType })}`,
    'response.ts': responseTxt,
    'parser.ts': parserTxt,
    'request.ts': requestTxt,
  });

  await writeFiles(join(output, 'outputs'), outputs);
  const modelsImports = Object.entries(commonSchemas).map(([name]) => name);
  await writeFiles(output, {
    'client.ts': backend(
      {
        name: clientName,
        servers: (spec.servers ?? []).map((server) => server.url) || [],
        options: options,
        makeImport,
      },
      style,
    ),
    ...inputFiles,
    ...endpoints,
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
      (dirent) => dirent.isDirectory() && ['schemas'].includes(dirent.name),
    ),
    getFolderExports(join(output, 'api'), settings.useTsExtension),
    getFolderExports(
      join(output, 'http'),
      settings.useTsExtension,
      ['ts'],
      (dirent) => !['response.ts', 'parser.ts'].includes(dirent.name),
    ),
  ];
  if (modelsImports.length) {
    folders.push(
      getFolderExports(join(output, 'models'), settings.useTsExtension),
    );
  }
  const [outputIndex, inputsIndex, apiIndex, httpIndex, modelsIndex] =
    await Promise.all(folders);
  await writeFiles(output, {
    'api/index.ts': apiIndex,
    'outputs/index.ts': outputIndex,
    'inputs/index.ts': inputsIndex || null,
    'http/index.ts': httpIndex,
    ...(modelsImports.length ? { 'models/index.ts': modelsIndex } : {}),
  });
  await writeFiles(output, {
    'index.ts': await getFolderExports(output, settings.useTsExtension, ['ts']),
  });
  if (settings.mode === 'full') {
    const configFiles: WriteContent = {
      'package.json': {
        ignoreIfExists: true,
        content: JSON.stringify(
          {
            name: settings.name
              ? `@${spinalcase(clientName.toLowerCase())}/sdk`
              : 'sdk',
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
    };
    if (readme) {
      configFiles['README.md'] = {
        ignoreIfExists: true,
        content: readme,
      };
    }
    await writeFiles(settings.output, configFiles);
  }

  await settings.formatCode?.({
    output: output,
    env: npmRunPathEnv(),
  });
}
