import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { analysisWorkspace, parseErrorFor, typecheck } from '@sdk-it/testing';
import { renderModule } from '@sdk-it/typescript';

test('a client sends no value for an omitted property or query parameter that declares a default', async () => {
  const { text } = await renderModule(
    {
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      servers: [{ url: 'https://orders.test' }],
      components: {
        schemas: {
          Status: { type: 'string', enum: ['open', 'closed'] },
        },
      },
      paths: {
        '/orders': {
          post: {
            operationId: 'createOrder',
            parameters: [
              {
                in: 'query',
                name: 'limit',
                schema: { type: 'integer', default: 10 },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      priority: {
                        type: 'string',
                        enum: ['low', 'high'],
                        default: 'low',
                      },
                      status: {
                        $ref: '#/components/schemas/Status',
                        default: 'open',
                      },
                      note: { type: 'string', default: 'none' },
                      quantity: { type: 'number', default: 1 },
                      gift: { type: 'boolean', default: false },
                      tags: {
                        type: 'array',
                        items: { type: 'string' },
                        default: ['new'],
                      },
                      kind: { const: 'order', default: 'order' },
                    },
                    required: ['name'],
                  },
                },
              },
            },
            responses: { '204': { description: 'Created' } },
          },
        },
      },
    },
    { name: 'Orders' },
  );
  await using workspace = await analysisWorkspace('request-defaults-', {
    'orders.ts': text,
  });
  const { createOrders } = await import(
    pathToFileURL(join(workspace.path, 'orders.ts')).href
  );
  let sent: Request | undefined;
  const client = createOrders({
    fetch: async (request: Request) => {
      sent = request;
      return new Response(null, { status: 204 });
    },
  });

  await client.request('POST /orders', { name: 'Ada' });

  assert.ok(sent);
  assert.equal(new URL(sent.url).search, '');
  assert.deepEqual(await sent.json(), { name: 'Ada' });
});

test('a request may omit a required readOnly property and must send a required writeOnly one', async () => {
  const { text } = await renderModule(
    {
      openapi: '3.1.0',
      info: { title: 'Accounts', version: '1.0.0' },
      servers: [{ url: 'https://accounts.test' }],
      components: {
        schemas: {
          Account: {
            type: 'object',
            properties: {
              id: { type: 'string', readOnly: true },
              password: { type: 'string', writeOnly: true },
              name: { type: 'string' },
            },
            required: ['id', 'password', 'name'],
          },
        },
      },
      paths: {
        '/accounts': {
          post: {
            operationId: 'createAccount',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Account' },
                },
              },
            },
            responses: { '204': { description: 'Created' } },
          },
        },
      },
    },
    { name: 'Accounts' },
  );
  await using workspace = await analysisWorkspace('request-read-only-', {
    'accounts.ts': text,
    'consumer.ts': `import { accounts } from './accounts.ts';
await accounts.request('POST /accounts', { name: 'Ada', password: 'secret' });
// @ts-expect-error password stays required
await accounts.request('POST /accounts', { name: 'Ada' });
`,
  });
  const { createAccounts } = await import(
    pathToFileURL(join(workspace.path, 'accounts.ts')).href
  );
  const bodies: unknown[] = [];
  const client = createAccounts({
    fetch: async (request: Request) => {
      bodies.push(await request.json());
      return new Response(null, { status: 204 });
    },
  });

  await client.request('POST /accounts', { name: 'Ada', password: 'secret' });
  await assert.rejects(
    client.request('POST /accounts', { name: 'Ada' }),
    parseErrorFor('password'),
  );
  const { diagnostics } = typecheck(workspace.tsconfig);

  assert.deepEqual(bodies, [{ name: 'Ada', password: 'secret' }]);
  assert.deepEqual(
    diagnostics.map(({ file, line, message }) => ({ file, line, message })),
    [],
  );
});

test('a property whose default is null still refuses null unless its type allows it', async () => {
  const { text } = await renderModule(
    {
      openapi: '3.1.0',
      info: { title: 'Notes', version: '1.0.0' },
      servers: [{ url: 'https://notes.test' }],
      paths: {
        '/notes': {
          post: {
            operationId: 'createNote',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { note: { type: 'string', default: null } },
                  },
                },
              },
            },
            responses: { '204': { description: 'Created' } },
          },
        },
      },
    },
    { name: 'Notes' },
  );
  await using workspace = await analysisWorkspace('request-default-null-', {
    'notes.ts': text,
  });
  const { createNotes } = await import(
    pathToFileURL(join(workspace.path, 'notes.ts')).href
  );
  const bodies: unknown[] = [];
  const client = createNotes({
    fetch: async (request: Request) => {
      bodies.push(await request.json());
      return new Response(null, { status: 204 });
    },
  });

  await client.request('POST /notes', { note: 'x' });
  await assert.rejects(
    client.request('POST /notes', { note: null }),
    parseErrorFor('note'),
  );

  assert.deepEqual(bodies, [{ note: 'x' }]);
});
