import { TemporaryFiles } from '@zukhruf/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';
import { parseErrorFor } from '@sdk-it/testing';

const spec = {
  openapi: '3.1.0',
  info: { title: 'Const', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/answers': {
      post: {
        operationId: 'answer',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answer'],
                properties: { answer: { type: 'string', const: 'none' } },
              },
            },
          },
        },
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
};

async function constClient(dir: { path: string }) {
  const specPath = join(dir.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));
  return rpc(specPath, {
    fetch: async () => new Response(null, { status: 204 }),
  });
}

test('a const property rejects any other value before a request is sent', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-const-');
  const client = await constClient(dir);

  await assert.rejects(
    client.request('POST /answers', { answer: 'maybe' }),
    parseErrorFor('answer'),
  );
});

test('a const property accepts its value', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-const-');
  const client = await constClient(dir);

  await assert.doesNotReject(
    client.request('POST /answers', { answer: 'none' }),
  );
});

function answers(property: object, required: string[]) {
  return {
    ...spec,
    paths: {
      '/answers': {
        post: {
          ...spec.paths['/answers'].post,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required,
                  properties: { answer: property },
                },
              },
            },
          },
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

test('a required const with a declared default equal to it is filled when absent', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-const-default-');
  const client = await clientOf(
    dir,
    answers({ type: 'string', const: 'none', default: 'none' }, ['answer']),
  );

  await assert.doesNotReject(client.request('POST /answers', {}));
});

test('a required object const with a declared default is filled when absent', async () => {
  await using dir = await new TemporaryFiles().directory(
    'rpc-const-object-default-',
  );
  const client = await clientOf(
    dir,
    answers({ const: { x: 1 }, default: { x: 1 } }, ['answer']),
  );

  await assert.doesNotReject(client.request('POST /answers', {}));
});

test('a const false property refuses true and accepts false', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-const-false-');
  const client = await clientOf(
    dir,
    answers({ type: 'boolean', const: false }, ['answer']),
  );

  await assert.rejects(
    client.request('POST /answers', { answer: true }),
    parseErrorFor('answer'),
  );
  await assert.doesNotReject(
    client.request('POST /answers', { answer: false }),
  );
});

test('an object const accepts exactly its JSON value and refuses any other', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-const-object-');
  const client = await clientOf(
    dir,
    answers({ const: { x: 1, tags: ['a'] } }, ['answer']),
  );

  await assert.doesNotReject(
    client.request('POST /answers', { answer: { x: 1, tags: ['a'] } }),
  );
  for (const wrong of [
    { x: 2, tags: ['a'] },
    { x: 1, tags: ['a'], y: 0 },
    { x: 1, tags: ['b'] },
  ]) {
    await assert.rejects(
      client.request('POST /answers', { answer: wrong }),
      parseErrorFor('answer'),
    );
  }
});
