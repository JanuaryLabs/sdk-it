import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { generate } from '@sdk-it/typescript';

test('a README request snippet is one statement that ends with one semicolon', async () => {
  await using output = await new TemporaryFiles().directory('readme-snippet-');

  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Demo', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'The pets',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
    { output: output.path, name: 'Demo', readme: true },
  );

  const readme = await readFile(join(output.path, 'README.md'), 'utf8');
  assert.match(
    readme,
    /^const result = await demo\.request\('GET \/pets', \{\}\);$/m,
  );
  assert.doesNotMatch(readme, /;;/);
});
