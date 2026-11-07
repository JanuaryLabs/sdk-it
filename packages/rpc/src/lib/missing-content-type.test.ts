import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';
import { APIError, Ok } from '@sdk-it/runtime';

// A response without Content-Type reads as the body the spec declares for its
// status; a status that declares no body reads as a Blob, the
// application/octet-stream that RFC 9110 §8.3 lets a recipient assume.
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
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { id: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'health',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'The service health',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/report': {
      get: {
        operationId: 'downloadReport',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'The report',
            content: { 'application/pdf': {} },
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

test('RPC client reads a declared JSON body without Content-Type as JSON', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-no-content-type-',
  );
  const response = new Response(new TextEncoder().encode('{"id":1}'));
  const client = await rpcClient(workspace.path, response);

  const result = await client.request('GET /order', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(result instanceof Ok);
  assert.deepEqual(result.data, { id: 1 });
});

test('RPC client reads a declared text body without Content-Type as a string', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-no-content-type-',
  );
  const response = new Response(new TextEncoder().encode('ok'));
  const client = await rpcClient(workspace.path, response);

  const result = await client.request('GET /health', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(result instanceof Ok);
  assert.equal(result.data, 'ok');
});

test('RPC client reads a declared binary body without Content-Type as a Blob of its bytes', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-no-content-type-',
  );
  const response = new Response(new Uint8Array([37, 80, 68, 70]));
  const client = await rpcClient(workspace.path, response);

  const result = await client.request('GET /report', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(result instanceof Ok);
  assert.ok(result.data instanceof Blob);
  assert.deepEqual([...(await result.data.bytes())], [37, 80, 68, 70]);
});

test('RPC client reads a declared JSON status with an empty body and no Content-Type as null', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-no-content-type-',
  );
  const response = new Response(new Uint8Array());
  const client = await rpcClient(workspace.path, response);

  const result = await client.request('GET /order', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(result instanceof Ok);
  assert.equal(result.data, null);
});

test('RPC client rejects an undeclared error status without Content-Type with an APIError whose data is a Blob of its bytes', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-no-content-type-',
  );
  const response = new Response(new TextEncoder().encode('boom'), {
    status: 500,
  });
  const client = await rpcClient(workspace.path, response);

  const error = await client
    .request('GET /order', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof APIError);
  assert.equal(error.status, 500);
  assert.ok(error.data instanceof Blob);
  assert.equal(await error.data.text(), 'boom');
  assert.equal(response.headers.get('Content-Type'), null);
});

test('RPC client reads a response with Content-Type by its Content-Type, not by the declared body', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-no-content-type-',
  );
  const response = new Response('{"id":1}', {
    headers: { 'Content-Type': 'text/plain' },
  });
  const client = await rpcClient(workspace.path, response);

  const result = await client.request('GET /order', {});

  assert.ok(result instanceof Ok);
  assert.equal(result.data, '{"id":1}');
});
