import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';

test('RPC client for a spec without servers asks for a baseUrl', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-rpc-base-url-'));
  try {
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
