import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { generate } from '@sdk-it/typescript';

test('a request body whose example is null gets a README snippet that sends null as $body', async () => {
  await using output = await new TemporaryFiles().directory(
    'null-request-body-snippet-',
  );

  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Demo', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/ping': {
          post: {
            operationId: 'ping',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'null' } } },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    },
    {
      output: output.path,
      name: 'Demo',
      packageName: '@acme/sdk',
      readme: true,
    },
  );

  const readme = await readFile(join(output.path, 'README.md'), 'utf8');
  assert.match(
    readme,
    /await demo\.request\('POST \/ping', \{\n {2}"\$body": null\n\}\)/,
  );
});
