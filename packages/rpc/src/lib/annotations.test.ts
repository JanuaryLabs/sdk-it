import { TemporaryFiles } from '@zukhruf/fs';
import { asSchema } from 'ai';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc, toAgents } from '@sdk-it/rpc';
import { parseErrorFor } from '@sdk-it/testing';

function bodySpec(body: object, components: object = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'Annotations', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    tags: [{ name: 'orders' }],
    components: { schemas: components },
    paths: {
      '/orders': {
        post: {
          operationId: 'createOrder',
          tags: ['orders'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: body } },
          },
          responses: {
            '200': {
              description: 'The body the server received',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    },
  };
}

async function echoClient(dir: { path: string }, document: object) {
  const specPath = join(dir.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(document));
  return rpc(specPath, {
    fetch: async (request: Request) =>
      new Response(await request.text(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

test('an omitted property with a default is not sent: the server applies its own default', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-no-default-');
  const client = await echoClient(
    dir,
    bodySpec(
      {
        type: 'object',
        required: ['item'],
        properties: {
          item: { type: 'string' },
          note: { type: 'string', default: 'none' },
          sort: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          kind: { const: 'order', default: 'order' },
          size: { $ref: '#/components/schemas/Size', default: 'small' },
        },
      },
      { Size: { type: 'string', enum: ['small', 'large'] } },
    ),
  );

  const received = await client.request('POST /orders', { item: 'tea' });

  assert.deepEqual(received.data, { item: 'tea' });
});

test('a required enum or const property with a default must be sent: a client never fills a default', async () => {
  await using dir = await new TemporaryFiles().directory(
    'rpc-required-default-',
  );
  const client = await echoClient(
    dir,
    bodySpec({
      type: 'object',
      required: ['sort', 'kind'],
      properties: {
        sort: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        kind: { const: 'order', default: 'order' },
      },
    }),
  );

  await assert.rejects(
    client.request('POST /orders', { kind: 'order' }),
    parseErrorFor('sort'),
  );
  await assert.rejects(
    client.request('POST /orders', { sort: 'desc' }),
    parseErrorFor('kind'),
  );
  assert.deepEqual(
    (await client.request('POST /orders', { sort: 'desc', kind: 'order' }))
      .data,
    { sort: 'desc', kind: 'order' },
  );
});

test('a required readOnly property may be left out of a request, a required writeOnly property may not', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-read-write-');
  const client = await echoClient(
    dir,
    bodySpec(
      {
        type: 'object',
        required: ['id', 'createdAt', 'password'],
        properties: {
          id: { type: 'string', readOnly: true },
          createdAt: { $ref: '#/components/schemas/Stamp', readOnly: true },
          password: { type: 'string', writeOnly: true },
        },
      },
      { Stamp: { type: 'string' } },
    ),
  );

  assert.deepEqual(
    (await client.request('POST /orders', { password: 'secret' })).data,
    { password: 'secret' },
  );
  await assert.rejects(
    client.request('POST /orders', {}),
    parseErrorFor('password'),
  );
});

test('an agent tool advertises each property annotation, inline and beside a $ref, where the keyword beside the $ref wins', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-tool-meta-');
  const specPath = join(dir.path, 'spec.json');
  await writeFile(
    specPath,
    JSON.stringify(
      bodySpec(
        {
          type: 'object',
          properties: {
            note: {
              type: 'string',
              title: 'Note',
              description: 'Free text',
              default: 'none',
              deprecated: true,
              examples: ['leave at door'],
            },
            size: {
              $ref: '#/components/schemas/Size',
              title: 'Order size',
              description: 'Size of this order',
              default: 'large',
              examples: ['large'],
            },
            id: { type: 'string', readOnly: true },
            password: { type: 'string', writeOnly: true },
            stamp: { $ref: '#/components/schemas/Stamp', readOnly: true },
            secret: { $ref: '#/components/schemas/Stamp', writeOnly: true },
          },
        },
        {
          Stamp: { type: 'string' },
          Size: {
            type: 'string',
            enum: ['small', 'large'],
            title: 'Size',
            description: 'A size',
            default: 'small',
            deprecated: true,
            examples: ['small'],
          },
        },
      ),
    ),
  );

  // baseUrl only constructs the agents; the test sends no request.
  const agents = await toAgents(specPath, {
    baseUrl: 'https://api.example.com',
  });
  const advertised = await asSchema(agents.orders.tools.createOrder.inputSchema)
    .jsonSchema;

  assert.deepEqual(advertised.properties, {
    note: {
      type: 'string',
      title: 'Note',
      description: 'Free text',
      default: 'none',
      deprecated: true,
      examples: ['leave at door'],
    },
    size: {
      type: 'string',
      enum: ['small', 'large'],
      title: 'Order size',
      description: 'Size of this order',
      default: 'large',
      deprecated: true,
      examples: ['large', 'small'],
    },
    id: { type: 'string', readOnly: true },
    password: { type: 'string', writeOnly: true },
    stamp: { type: 'string', readOnly: true },
    secret: { type: 'string', writeOnly: true },
  });
});
