import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';

test('RPC client for a spec without servers asks for a baseUrl', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-base-url-',
  );
  const dir = workspace.path;
  const specPath = join(dir, 'openapi.json');
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Things', version: '1.0.0' },
      paths: {
        '/things': {
          get: {
            operationId: 'listThings',
            tags: ['things'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'array' } },
                },
              },
            },
          },
        },
      },
    }),
  );

  await assert.rejects(rpc(specPath), {
    message: 'rpc: the spec declares no servers; pass options.baseUrl',
  });
});
