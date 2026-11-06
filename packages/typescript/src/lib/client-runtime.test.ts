import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { analysisWorkspace } from '@sdk-it/testing';
import { renderModule } from '@sdk-it/typescript';

/**
 * GET /users takes an optional (or required) `limit` query and an optional
 * `x-trace-id` header; POST /users takes a JSON body with `limit`. GET /users
 * answers 200 with JSON, or 204 when `noContent`.
 */
function usersSpec(options: {
  servers: string[];
  limit?: 'optional' | 'required';
  noContent?: boolean;
}): OpenAPIObject {
  const json = {
    '200': {
      description: 'OK',
      content: { 'application/json': { schema: {} } },
    },
  };
  return {
    openapi: '3.1.0',
    info: { title: 'Users', version: '1.0.0' },
    servers: options.servers.map((url) => ({ url })),
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          tags: ['users'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: options.limit === 'required',
              schema: { type: 'number' },
            },
            { name: 'x-trace-id', in: 'header', schema: { type: 'string' } },
          ],
          responses: options.noContent
            ? { '204': { description: 'No Content' } }
            : json,
        },
        post: {
          operationId: 'createUser',
          tags: ['users'],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { limit: { type: 'number' } },
                },
              },
            },
          },
          responses: json,
        },
      },
    },
  };
}

/** The SDK module that renderModule generates from `spec`, loaded. */
async function loadSdk(spec: OpenAPIObject, name: string) {
  const { text } = await renderModule(spec, { name });
  await using workspace = await analysisWorkspace('client-runtime-', {
    'sdk.ts': text,
  });
  return await import(pathToFileURL(join(workspace.path, 'sdk.ts')).href);
}

/** A fetch that fails the test if the client calls it. */
function unreachable(): never {
  throw new Error('the client called fetch');
}

describe('emitted client runtime', () => {
  test('basic client: GET request is dispatched to fetch with method and url', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'TestClient');
    const client = sdk.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: (request: Request) =>
        Response.json({
          method: request.method,
          url: request.url,
        }),
    });

    const data = await client.request('GET /users', { limit: 5 });

    assert.deepStrictEqual(data, {
      method: 'GET',
      url: 'https://api.example.com/users?limit=5',
    });
  });

  test('with one server: omitting baseUrl uses the declared server', async () => {
    const sdk = await loadSdk(
      usersSpec({ servers: ['https://api.example.com'] }),
      'ApiClient',
    );
    const client = sdk.createApiClient({
      fetch: (request: Request) => Response.json({ url: request.url }),
    });

    const data = await client.request('GET /users', {});

    assert.deepStrictEqual(data, { url: 'https://api.example.com/users' });
  });

  test('with multiple servers: omitting baseUrl requires an explicit choice', async () => {
    const sdk = await loadSdk(
      usersSpec({
        servers: ['https://api.example.com', 'https://staging.example.com'],
      }),
      'ApiClient',
    );
    const client = sdk.createApiClient({ fetch: unreachable });

    await assert.rejects(client.request('GET /users', {}), /baseUrl/);
  });

  test('with-servers client: explicit baseUrl overrides the default server', async () => {
    const sdk = await loadSdk(
      usersSpec({
        servers: ['https://api.example.com', 'https://staging.example.com'],
      }),
      'ApiClient',
    );
    const client = sdk.createApiClient({
      fetch: (request: Request) => Response.json({ url: request.url }),
      baseUrl: 'https://staging.example.com',
    });

    const data = await client.request('GET /users', {});

    assert.deepStrictEqual(data, { url: 'https://staging.example.com/users' });
  });

  test('with server variables: expanded URLs remain available for explicit selection', async () => {
    const sdk = await loadSdk(
      {
        ...usersSpec({ servers: [] }),
        servers: [
          {
            url: 'https://{env}.api.example.com/v{version}',
            variables: {
              env: { default: 'production', enum: ['production', 'staging'] },
              version: { default: '1', enum: ['1', '2'] },
            },
          },
        ],
      },
      'ApiClient',
    );
    const client = sdk.createApiClient({
      baseUrl: 'https://production.api.example.com/v1',
      fetch: (request: Request) => Response.json({ url: request.url }),
    });

    const data = await client.request('GET /users', {});

    assert.deepStrictEqual(data, {
      url: 'https://production.api.example.com/v1/users',
    });
    assert.deepStrictEqual(sdk.servers, [
      'https://production.api.example.com/v1',
      'https://production.api.example.com/v2',
      'https://staging.api.example.com/v1',
      'https://staging.api.example.com/v2',
    ]);
  });

  test('headers option: default headers from options.headers are sent', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'TestClient');
    const client = sdk.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: (request: Request) =>
        Response.json({ custom: request.headers.get('x-custom') }),
      headers: { 'x-custom': 'hello' },
    });

    const data = await client.request('GET /users', {});

    assert.deepStrictEqual(data, { custom: 'hello' });
  });

  test('per-request headers override default headers from options', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'TestClient');
    const client = sdk.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: (request: Request) =>
        Response.json({ custom: request.headers.get('x-custom') }),
      headers: { 'x-custom': 'default' },
    });

    const data = await client.request(
      'GET /users',
      {},
      { headers: { 'x-custom': 'per-request' } },
    );

    assert.deepStrictEqual(data, { custom: 'per-request' });
  });

  test('POST /users sends JSON body and content-type header', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'TestClient');
    const client = sdk.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: async (request: Request) =>
        Response.json({
          method: request.method,
          contentType: request.headers.get('Content-Type'),
          body: await request.json(),
        }),
    });

    const data = await client.request('POST /users', { limit: 7 });

    assert.deepStrictEqual(data, {
      method: 'POST',
      contentType: 'application/json',
      body: { limit: 7 },
    });
  });

  test('prepare returns url+init without firing fetch', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'TestClient');
    const client = sdk.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: unreachable,
    });

    const prepared = await client.prepare('GET /users', { limit: 9 });

    assert.strictEqual(prepared.init.method, 'GET');
    assert.strictEqual(
      String(prepared.url),
      'https://api.example.com/users?limit=9',
    );
    assert.strictEqual(typeof prepared.parse, 'function');
  });

  test('baseUrl accepts function returning string', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'TestClient');
    const client = sdk.createTestClient({
      baseUrl: () => 'https://dynamic.example.com',
      fetch: (request: Request) => Response.json({ url: request.url }),
    });

    const data = await client.request('GET /users', {});

    assert.deepStrictEqual(data, { url: 'https://dynamic.example.com/users' });
  });

  test('baseUrl accepts async function returning string', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'TestClient');
    const client = sdk.createTestClient({
      baseUrl: async () => 'https://async.example.com',
      fetch: (request: Request) => Response.json({ url: request.url }),
    });

    const data = await client.request('GET /users', {});

    assert.deepStrictEqual(data, { url: 'https://async.example.com/users' });
  });

  test('skipValidation bypasses zod schema enforcement on input', async () => {
    const sdk = await loadSdk(
      usersSpec({ servers: [], limit: 'required' }),
      'TestClient',
    );
    const client = sdk.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: (request: Request) => Response.json({ url: request.url }),
      skipValidation: true,
    });

    const data = await client.request('GET /users', { limit: 'not-a-number' });

    assert.deepStrictEqual(data, {
      url: 'https://api.example.com/users?limit=not-a-number',
    });
  });
});

describe('emitted client runtime: 204 No Content responses', () => {
  test('204 without a Content-Type header (the spec-correct case) resolves to null data', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'NoContentClient');
    const client = sdk.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: () => new Response(null, { status: 204 }),
    });

    const data = await client.request('GET /users', {});

    assert.strictEqual(data, null);
  });

  test('204 with a Content-Type header resolves to null data (body short-circuited)', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'NoContentClient');
    const client = sdk.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: () =>
        new Response(null, {
          status: 204,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const data = await client.request('GET /users', {});

    assert.strictEqual(data, null);
  });

  test('205 Reset Content without a Content-Type header resolves to null data', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'NoContentClient');
    const client = sdk.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: () => new Response(null, { status: 205 }),
    });

    const data = await client.request('GET /users', {});

    assert.strictEqual(data, null);
  });

  test('a body-bearing status (200) with no Content-Type still throws — the guard only relaxes for no-body statuses', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'NoContentClient');
    const client = sdk.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: () => new Response(null, { status: 200 }),
    });

    await assert.rejects(
      () => client.request('GET /users', {}),
      /Content-Type header is missing/,
    );
  });

  test('304 Not Modified (no Content-Type) surfaces as an APIError with status 304 and null data, not a parser throw', async () => {
    const sdk = await loadSdk(usersSpec({ servers: [] }), 'NoContentClient');
    const client = sdk.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: () => new Response(null, { status: 304 }),
    });

    await assert.rejects(
      () => client.request('GET /users', {}),
      (error: unknown) => {
        assert.ok(error instanceof sdk.APIError);
        assert.ok(Error.isError(error) && 'status' in error && 'data' in error);
        assert.strictEqual(error.status, 304);
        assert.strictEqual(error.data, null);
        return true;
      },
    );
  });

  test('operation declaring NoContent output: request resolves to null and parse yields a NoContent instance', async () => {
    const sdk = await loadSdk(
      usersSpec({ servers: [], noContent: true }),
      'NoContentClient',
    );
    const client = sdk.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: () => new Response(null, { status: 204 }),
    });

    const data = await client.request('GET /users', {});
    assert.strictEqual(data, null);

    const prepared = await client.prepare('GET /users', {});
    const response = await prepared.parse(new Response(null, { status: 204 }));

    assert.ok(response instanceof sdk.NoContent);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.data, null);
  });
});
