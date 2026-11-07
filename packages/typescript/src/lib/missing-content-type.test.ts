import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// A response without Content-Type reads as the body the spec declares for its
// status; a status that declares no body reads as a Blob, the
// application/octet-stream that RFC 9110 §8.3 lets a recipient assume.
const spec: OpenAPIObject = {
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

/** Generates the SDK into `directory`, imports it, and builds a client whose fetch answers `response`. */
async function generateClient(directory: string, response: Response) {
  await generate(spec, {
    output: directory,
    name: 'Store',
    readme: false,
    mode: 'full',
  });
  const sdk: {
    createStore: (settings: unknown) => {
      request(endpoint: string, input: unknown): Promise<unknown>;
    };
    APIError: new (...args: never[]) => Error & {
      status: number;
      data: unknown;
    };
  } = await import(pathToFileURL(join(directory, 'src/index.ts')).href);
  const client = sdk.createStore({
    baseUrl: 'https://api.test',
    fetch: async () => response,
  });
  return { sdk, client };
}

void test('a declared JSON body without Content-Type resolves to the parsed JSON', async () => {
  await using workspace = await workspaceDirectory('no-content-type-json-');
  const response = new Response(new TextEncoder().encode('{"id":1}'));
  const { client } = await generateClient(workspace.path, response);

  const order = await client.request('GET /order', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.deepEqual(order, { id: 1 });
});

void test('a declared text body without Content-Type resolves to the string', async () => {
  await using workspace = await workspaceDirectory('no-content-type-text-');
  const response = new Response(new TextEncoder().encode('ok'));
  const { client } = await generateClient(workspace.path, response);

  const health = await client.request('GET /health', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.equal(health, 'ok');
});

void test('a declared binary body without Content-Type resolves to a Blob of its bytes', async () => {
  await using workspace = await workspaceDirectory('no-content-type-binary-');
  const response = new Response(new Uint8Array([37, 80, 68, 70]));
  const { client } = await generateClient(workspace.path, response);

  const report = await client.request('GET /report', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(report instanceof Blob);
  assert.deepEqual([...(await report.bytes())], [37, 80, 68, 70]);
});

void test('a declared JSON status with an empty body and no Content-Type resolves to null', async () => {
  await using workspace = await workspaceDirectory('no-content-type-empty-');
  const response = new Response(new Uint8Array());
  const { client } = await generateClient(workspace.path, response);

  const order = await client.request('GET /order', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.equal(order, null);
});

void test('an undeclared error status without Content-Type rejects with an APIError whose data is a Blob of its bytes', async () => {
  await using workspace = await workspaceDirectory('no-content-type-error-');
  const response = new Response(new TextEncoder().encode('boom'), {
    status: 500,
  });
  const { sdk, client } = await generateClient(workspace.path, response);

  const error = await client
    .request('GET /order', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof sdk.APIError);
  assert.equal(error.status, 500);
  assert.ok(error.data instanceof Blob);
  assert.equal(await error.data.text(), 'boom');
  assert.equal(response.headers.get('Content-Type'), null);
});

void test('a response with Content-Type is read by its Content-Type, not by the declared body', async () => {
  await using workspace = await workspaceDirectory('content-type-wins-');
  const response = new Response('{"id":1}', {
    headers: { 'Content-Type': 'text/plain' },
  });
  const { client } = await generateClient(workspace.path, response);

  const order = await client.request('GET /order', {});

  assert.equal(order, '{"id":1}');
});
