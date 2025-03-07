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

  await writeFiles(settings.output, {
    'outputs/index.ts': '',
    'inputs/index.ts': '',
    // 'README.md': readme,
  });

  await writeFiles(join(settings.output, 'http'), {
    'parse-response.ts': clientTxt,
    'send-request.ts': sendRequest,
    'response.ts': responseTxt,
    'parser.ts': parserTxt,
    'request.ts': requestTxt,
  });

  await writeFiles(join(settings.output, 'outputs'), outputs);

  await writeFiles(settings.output, {
    ...clientFiles,
    'zod.ts': `import z from 'zod';\n${Object.entries(commonSchemas)
      .map(([name, schema]) => `export const ${name} = ${schema};`)
      .join('\n')}`,
  });

  const [index, outputIndex, inputsIndex, httpIndex] = await Promise.all([
    getFolderExports(settings.output),
    getFolderExports(join(settings.output, 'outputs')),
    getFolderExports(join(settings.output, 'inputs')),
    getFolderExports(join(settings.output, 'http')),
  ]);

  await writeFiles(settings.output, {
    'index.ts': index,
    'outputs/index.ts': outputIndex,
    'inputs/index.ts': inputsIndex,
    'http/index.ts': httpIndex,
  });

  await settings.formatCode?.({
    output: settings.output,
    env: npmRunPathEnv(),
  });
}
