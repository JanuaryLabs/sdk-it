import { TemporaryFiles } from '@zukhruf/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';
import { parseErrorFor } from '@sdk-it/testing';

function shapes(property: object) {
  return {
    openapi: '3.1.0',
    info: { title: 'Shapes', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/shapes': {
        post: {
          operationId: 'draw',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['shape'],
                  properties: { shape: property },
                },
              },
            },
          },
          responses: { '204': { description: 'No Content' } },
        },
      },
    },
  };
}

async function clientOf(dir: { path: string }, document: object) {
  const specPath = join(dir.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(document));
  return rpc(specPath, {
    fetch: async () => new Response(null, { status: 204 }),
  });
}

test('an enum with object and array members accepts each member and refuses any other value', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-enum-json-');
  const client = await clientOf(
    dir,
    shapes({ enum: [{ kind: 'circle' }, [1, 2], 'plain'] }),
  );

  for (const member of [{ kind: 'circle' }, [1, 2], 'plain']) {
    await assert.doesNotReject(
      client.request('POST /shapes', { shape: member }),
    );
  }
  for (const wrong of [{ kind: 'square' }, [1], { kind: 'circle', extra: 1 }]) {
    await assert.rejects(
      client.request('POST /shapes', { shape: wrong }),
      parseErrorFor('shape'),
    );
  }
});

test('a required enum with an object default equal to a member is filled when absent', async () => {
  await using dir = await new TemporaryFiles().directory(
    'rpc-enum-json-default-',
  );
  const client = await clientOf(
    dir,
    shapes({
      enum: [{ kind: 'circle' }, 'plain'],
      default: { kind: 'circle' },
    }),
  );

  await assert.doesNotReject(client.request('POST /shapes', {}));
});
