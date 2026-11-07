import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// OpenAPI 3.2 Responses Object: a range key such as `4XX` describes every
// status of its class, and an explicit code takes precedence over the range.
const json = (properties: Record<string, { type: string }>) => ({
  'application/json': { schema: { type: 'object', properties } },
});

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

void test('a 404 matched only by a declared 4XX JSON range rejects with the parsed JSON when Content-Type says JSON', async () => {
  await using workspace = await workspaceDirectory('status-range-json-');
  const response = Response.json({ code: 'missing' }, { status: 404 });
  const { sdk, client } = await generateClient(workspace.path, response);

  const error = await client
    .request('GET /order', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof sdk.APIError);
  assert.equal(error.status, 404);
  assert.deepEqual(error.data, { code: 'missing' });
});

void test('a 404 matched only by a declared 4XX JSON range rejects with the parsed JSON without Content-Type', async () => {
  await using workspace = await workspaceDirectory('status-range-no-type-');
  const response = new Response(
    new TextEncoder().encode('{"code":"missing"}'),
    {
      status: 404,
    },
  );
  const { sdk, client } = await generateClient(workspace.path, response);

  const error = await client
    .request('GET /order', {})
    .catch((reason: unknown) => reason);

  assert.equal(response.headers.get('Content-Type'), null);
  assert.ok(error instanceof sdk.APIError);
  assert.equal(error.status, 404);
  assert.deepEqual(error.data, { code: 'missing' });
});

void test('an explicit 404 takes precedence over the 4XX range for a 404', async () => {
  await using workspace = await workspaceDirectory('status-range-explicit-');
  const response = new Response(
    new TextEncoder().encode('{"code":"missing"}'),
    {
      status: 404,
    },
  );
  const { sdk, client } = await generateClient(workspace.path, response);

  const error = await client
    .request('GET /item', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof sdk.APIError);
  assert.equal(error.status, 404);
  assert.equal(error.data, '{"code":"missing"}');
});

void test('a 400 beside an explicit 404 is read by the 4XX range', async () => {
  await using workspace = await workspaceDirectory('status-range-other-');
  const response = new Response(new TextEncoder().encode('{"code":"bad"}'), {
    status: 400,
  });
  const { sdk, client } = await generateClient(workspace.path, response);

  const error = await client
    .request('GET /item', {})
    .catch((reason: unknown) => reason);

  assert.ok(error instanceof sdk.APIError);
  assert.equal(error.status, 400);
  assert.deepEqual(error.data, { code: 'bad' });
});

void test('a 201 matched by a declared 2XX JSON range resolves to the parsed body without Content-Type', async () => {
  await using workspace = await workspaceDirectory('status-range-success-');
  const response = new Response(new TextEncoder().encode('{"id":7}'), {
    status: 201,
  });
  const { client } = await generateClient(workspace.path, response);

  const item = await client.request('POST /items', {});

  assert.equal(response.headers.get('Content-Type'), null);
  assert.deepEqual(item, { id: 7 });
});

void test('a range types its body: a 2XX result is the declared body, a 4XX error carries the declared data', async () => {
  await using workspace = await workspaceDirectory('status-range-types-');
  await generate(spec, {
    output: workspace.path,
    name: 'Store',
    readme: false,
    mode: 'full',
  });
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `import { createStore, type StoreEndpoints } from './index.ts';
const client = createStore({ baseUrl: 'https://api.test' });
type OrderError = StoreEndpoints['GET /order']['error'];
export async function created(): Promise<number | undefined> {
  const item = await client.request('POST /items', {});
  return item.id;
}
export function code(error: OrderError): string | undefined {
  return 'status' in error && error.status === 404
    ? error.data.code
    : undefined;
}
`,
  );

  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});
