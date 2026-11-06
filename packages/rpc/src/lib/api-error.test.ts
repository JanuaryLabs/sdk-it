import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';
import { APIError, BadRequest, NotFound } from '@sdk-it/runtime';

test('RPC client rejects a declared error status with its APIError subclass, an Error with a stack and a readable message', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-api-error-',
  );
  const dir = workspace.path;
  const specPath = join(dir, 'openapi.json');
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      paths: {
        '/orders/{id}': {
          get: {
            operationId: 'getOrder',
            tags: ['orders'],
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
              '400': {
                description: 'Bad request',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { message: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );
  const client = await rpc(specPath, {
    baseUrl: 'https://api.example.com',
    fetch: async () =>
      Response.json({ message: 'id must be numeric' }, { status: 400 }),
  });

  await assert.rejects(
    client.request('GET /orders/{id}', { id: 'abc' }),
    (error) => {
      assert.ok(error instanceof BadRequest);
      assert.equal(error instanceof APIError, true);
      assert.equal(error instanceof Error, true, 'an HTTP error is an Error');
      assert.equal(error.status, 400);
      assert.equal(error.headers.get('content-type'), 'application/json');
      assert.deepStrictEqual(error.data, { message: 'id must be numeric' });
      assert.equal(
        error.message,
        'Request failed with status code 400: {"message":"id must be numeric"}',
      );
      assert.ok(error.stack);
      assert.match(
        error.stack,
        /^APIError: Request failed with status code 400/,
      );
      return true;
    },
  );
});

test('RPC client rejects an undeclared error status with an APIError whose message stays one short line', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-api-error-',
  );
  const dir = workspace.path;
  const specPath = join(dir, 'openapi.json');
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            tags: ['orders'],
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
  const page = `<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n${'<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n'.repeat(6)}`;
  const client = await rpc(specPath, {
    baseUrl: 'https://api.example.com',
    fetch: async () =>
      new Response(page, {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
  });

  await assert.rejects(client.request('GET /orders', {}), (error) => {
    assert.ok(error instanceof APIError);
    assert.equal(error.constructor, APIError);
    assert.equal(error instanceof Error, true, 'an HTTP error is an Error');
    assert.equal(error.status, 502);
    assert.equal(error.data, page);
    assert.equal(
      error.message,
      'Request failed with status code 502: <html> <head><title>502 Bad Gateway</title></head> <body> <center><h1>502 Bad Gateway</h1></center> <hr><center>nginx</center> </body> </html> <!-- a padding to disable MSIE and Chrome friendly error …',
    );
    return true;
  });
});

test('RPC client summarizes a JSON array error body in the message', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-api-error-',
  );
  const dir = workspace.path;
  const specPath = join(dir, 'openapi.json');
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            tags: ['orders'],
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
  const client = await rpc(specPath, {
    baseUrl: 'https://api.example.com',
    fetch: async () =>
      Response.json([{ field: 'sku', message: 'is required' }], {
        status: 422,
      }),
  });

  await assert.rejects(client.request('GET /orders', {}), (error) => {
    assert.ok(error instanceof APIError);
    assert.equal(
      error.message,
      'Request failed with status code 422: [{"field":"sku","message":"is required"}]',
    );
    return true;
  });
});

test('RPC client rejects a problem+json error with its APIError subclass carrying the problem details', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-rpc-api-error-',
  );
  const specPath = join(workspace.path, 'openapi.json');
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      paths: {
        '/orders/latest': {
          get: {
            operationId: 'latestOrder',
            tags: ['orders'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
              '404': {
                description: 'No order yet',
                content: {
                  'application/problem+json': {
                    schema: {
                      type: 'object',
                      properties: {
                        title: { type: 'string' },
                        status: { type: 'integer' },
                        detail: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );
  const problem = { title: 'Not Found', status: 404, detail: 'No order yet' };
  const client = await rpc(specPath, {
    baseUrl: 'https://api.example.com',
    fetch: async () =>
      new Response(JSON.stringify(problem), {
        status: 404,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
  });

  await assert.rejects(client.request('GET /orders/latest', {}), (error) => {
    assert.ok(error instanceof NotFound);
    assert.deepStrictEqual(error.data, problem);
    return true;
  });
});
