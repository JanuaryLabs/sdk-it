import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';
import { APIError, APIResponse } from '@sdk-it/runtime';

// OpenAPI 3.2 Responses Object: a range key such as `4XX` describes every
// status of its class, and an explicit code takes precedence over the range.
const json = (properties: Record<string, { type: string }>) => ({
  'application/json': { schema: { type: 'object', properties } },
});

const spec = {
  openapi: '3.1.0',
  info: { title: 'Store', version: '1.0.0' },
  paths: {
    '/order': {
      get: {
        operationId: 'getOrder',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'The order',
            content: json({ id: { type: 'integer' } }),
          },
          '4XX': {
            description: 'A client error',
            content: json({ code: { type: 'string' } }),
          },
        },
      },
    },
    '/item': {
      get: {
        operationId: 'getItem',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'The item',
            content: json({ id: { type: 'integer' } }),
          },
          '404': {
            description: 'No such item',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
          '4XX': {
            description: 'A client error',
            content: json({ code: { type: 'string' } }),
          },
        },
      },
    },
    '/items': {
      post: {
        operationId: 'createItem',
        tags: ['orders'],
        responses: {
          '2XX': {
            description: 'The new item',
            content: json({ id: { type: 'integer' } }),
          },
        },
      },
    },
  },
};

/** Writes the spec into `directory` and builds an rpc client whose fetch answers `response`. */
async function rpcClient(directory: string, response: Response) {
  const specPath = join(directory, 'openapi.json');
  await writeFile(specPath, JSON.stringify(spec));
  return rpc(specPath, {
    baseUrl: 'https://api.example.com',
    fetch: async () => response,
  });
}

test('RPC client rejects a 404 matched only by a declared 4XX JSON range with the parsed JSON when Content-Type says JSON', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-range-',
  );
  const response = Response.json({ code: 'missing' }, { status: 404 });
  const client = await rpcClient(workspace.path, response);

  const error = await client
    .request('GET /order', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof APIError);
  assert.equal(error.status, 404);
  assert.deepEqual(error.data, { code: 'missing' });
});

test('RPC client rejects a 404 matched only by a declared 4XX JSON range with the parsed JSON without Content-Type', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-range-',
  );
  const response = new Response(
    new TextEncoder().encode('{"code":"missing"}'),
    {
      status: 404,
    },
  );
  const client = await rpcClient(workspace.path, response);

  const error = await client
    .request('GET /order', {})
    .catch((reason: unknown) => reason);

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(error instanceof APIError);
  assert.equal(error.status, 404);
  assert.deepEqual(error.data, { code: 'missing' });
});

test('RPC client reads a 404 by the explicit 404 entry, not the 4XX range', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-range-',
  );
  const response = new Response(
    new TextEncoder().encode('{"code":"missing"}'),
    {
      status: 404,
    },
  );
  const client = await rpcClient(workspace.path, response);

  const error = await client
    .request('GET /item', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof APIError);
  assert.equal(error.status, 404);
  assert.equal(error.data, '{"code":"missing"}');
});

test('RPC client reads a 400 beside an explicit 404 by the 4XX range', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-range-',
  );
  const response = new Response(new TextEncoder().encode('{"code":"bad"}'), {
    status: 400,
  });
  const client = await rpcClient(workspace.path, response);

  const error = await client
    .request('GET /item', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof APIError);
  assert.equal(error.status, 400);
  assert.deepEqual(error.data, { code: 'bad' });
});

test('RPC client reads a 201 matched by a declared 2XX JSON range as the parsed body without Content-Type', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-range-',
  );
  const response = new Response(new TextEncoder().encode('{"id":7}'), {
    status: 201,
  });
  const client = await rpcClient(workspace.path, response);

  const result = await client.request('POST /items', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(result instanceof APIResponse);
  assert.equal(result.status, 201);
  assert.deepEqual(result.data, { id: 7 });
});
