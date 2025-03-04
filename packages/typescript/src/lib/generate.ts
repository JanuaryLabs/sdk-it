import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { getFolderExports, writeFiles } from '@sdk-it/core';

import { generateCode } from './generator.ts';
import { generateClientSdk } from './sdk.ts';

export async function generate(
  spec: OpenAPIObject,
  settings: {
    output: string;
  },
) {
  const { commonSchemas, groups, outputs } = generateCode({
    spec,
    style: 'github',
    target: 'javascript',
  });
  const clientFiles = generateClientSdk({
    name: 'Client',
    groups: groups,
  });
  await writeFiles(settings.output, {
    'outputs/index.ts': '',
    'inputs/index.ts': '',
  });
  await writeFiles(join(settings.output, 'outputs'), outputs);
  await writeFiles(settings.output, {
    ...clientFiles,
    'zod.ts': `import z from 'zod';\n${Object.entries(commonSchemas)
      .map(([name, schema]) => `export const ${name} = ${schema};`)
      .join('\n')}`,
  });

  const [index, outputIndex, inputsIndex] = await Promise.all([
    getFolderExports(settings.output),
    getFolderExports(join(settings.output, 'outputs')),
    getFolderExports(join(settings.output, 'inputs')),
  ]);

  await writeFiles(settings.output, {
    'index.ts': index,
    'outputs/index.ts': outputIndex,
    'inputs/index.ts': inputsIndex,
  });
}
