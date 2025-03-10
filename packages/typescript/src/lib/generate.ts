import { join } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { getFolderExports, methods, writeFiles } from '@sdk-it/core';

import { generateCode } from './generator.ts';
import clientTxt from './http/client.txt';
import parserTxt from './http/parser.txt';
import requestTxt from './http/request.txt';
import responseTxt from './http/response.txt';
import sendRequest from './http/send-request.txt';
import { generateClientSdk } from './sdk.ts';
import { securityToOptions } from './utils.ts';

function security(spec: OpenAPIObject) {
  const security = spec.security || [];
  const components = spec.components || {};
  const securitySchemas = components.securitySchemes || {};
  const paths = Object.values(spec.paths ?? {});

  const options = securityToOptions(security, securitySchemas);

  for (const it of paths) {
    for (const method of methods) {
      const operation = it[method];
      if (!operation) {
        continue;
      }
      Object.assign(
        options,
        securityToOptions(operation.security || [], securitySchemas, 'input'),
      );
    }
  }
  return options;
}

export async function generate(
  spec: OpenAPIObject,
  settings: {
    output: string;
    name?: string;
    /**
     * full: generate a full project including. useful for monorepo/workspaces
     * minimal: generate only the client sdk
     */
    mode?: 'full' | 'minimal';
    formatCode?: (options: {
      output: string;
      env: ReturnType<typeof npmRunPathEnv>;
    }) => void | Promise<void>;
  },
) {
  const { commonSchemas, groups, outputs } = generateCode({
    spec,
    style: 'github',
    target: 'javascript',
  });
  const output =
    settings.mode === 'full' ? join(settings.output, 'src') : settings.output;

  const options = security(spec);

  const clientFiles = generateClientSdk({
    name: settings.name || 'Client',
    operations: groups,
    servers: spec.servers?.map((server) => server.url) || [],
    options: options,
  });

  // const readme = generateReadme(spec, {
  //   name: settings.name || 'Client',
  // });

  await writeFiles(output, {
    'outputs/index.ts': '',
    'inputs/index.ts': '',
    // 'README.md': readme,
  });

  await writeFiles(join(output, 'http'), {
    'parse-response.ts': clientTxt,
    'send-request.ts': sendRequest,
    'response.ts': responseTxt,
    'parser.ts': parserTxt,
    'request.ts': requestTxt,
  });

  await writeFiles(join(output, 'outputs'), outputs);

  const imports = Object.entries(commonSchemas).map(([name]) => name);
  await writeFiles(output, {
    ...clientFiles,
    ...Object.fromEntries(
      Object.entries(commonSchemas).map(([name, schema]) => [
        `models/${name}.ts`,
        [
          `import { z } from 'zod';`,
          ...exclude(imports, [name]).map(
            (it) => `import type { ${it} } from './${it}.ts';`,
          ),
          `export type ${name} = ${schema};`,
        ].join('\n'),
      ]),
    ),
  });

  const [index, outputIndex, inputsIndex, httpIndex, modelsIndex] =
    await Promise.all([
      getFolderExports(output),
      getFolderExports(join(output, 'outputs')),
      getFolderExports(join(output, 'inputs')),
      getFolderExports(join(output, 'http')),
      getFolderExports(join(output, 'models')),
    ]);
  await writeFiles(output, {
    'index.ts': index,
    'outputs/index.ts': outputIndex,
    'inputs/index.ts': inputsIndex,
    'http/index.ts': httpIndex,
    'models/index.ts': modelsIndex,
  });
  if (settings.mode === 'full') {
    await writeFiles(settings.output, {
      'package.json': {
        ignoreIfExists: true,
        content: `{"type":"module","main":"./src/index.ts","dependencies":{"fast-content-type-parse":"^3.0.0"}}`,
      },
    });
  }

  await settings.formatCode?.({
    output: output,
    env: npmRunPathEnv(),
  });
}

function exclude<T>(list: T[], exclude: T[]): T[] {
  return list.filter((it) => !exclude.includes(it));
}
