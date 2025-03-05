import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { getFolderExports, writeFiles } from '@sdk-it/core';

import { generateCode } from './generator.ts';
import clientTxt from './http/client.txt';
import parserTxt from './http/parser.txt';
import requestTxt from './http/request.txt';
import responseTxt from './http/response.txt';
import sendRequest from './http/send-request.txt';
import { generateReadme } from './readme-generator.ts';
import { generateClientSdk } from './sdk.ts';

export async function generate(
  spec: OpenAPIObject,
  settings: {
    output: string;
    name?: string;
  },
) {
  const { commonSchemas, groups, outputs } = generateCode({
    spec,
    style: 'github',
    target: 'javascript',
  });

  const clientFiles = generateClientSdk({
    name: settings.name || 'Client',
    groups: groups,
    servers: spec.servers?.map((server) => server.url) || [],
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
}
