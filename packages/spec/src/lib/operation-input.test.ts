import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import {
  type OperationInput,
  type TunedOperationObject,
  forEachOperation,
  operationInputs,
  toIR,
} from '@sdk-it/spec';

const logs = { type: 'array', items: { type: 'string' } } as const;

const document: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Chats', version: '1.0.0' },
  paths: {
    '/chats/{chatId}': {
      put: {
        operationId: 'updateChat',
        parameters: [
          {
            in: 'path',
            name: 'chatId',
            required: true,
            schema: { type: 'string' },
          },
          { in: 'query', name: 'draft', schema: { type: 'boolean' } },
          {
            in: 'header',
            name: 'x-trace',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/xml': {
              schema: {
                type: 'object',
                properties: { xmlOnly: { type: 'string' } },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  note: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['content'],
              },
            },
          },
        },
        responses: { '204': { description: 'Updated' } },
      },
    },
    '/logs': {
      post: {
        operationId: 'writeLogs',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: logs } },
        },
        responses: { '204': { description: 'Written' } },
      },
    },
    '/drafts': {
      post: {
        operationId: 'writeDrafts',
        requestBody: { content: { 'application/json': { schema: logs } } },
        responses: { '204': { description: 'Written' } },
      },
    },
    '/ping': {
      get: {
        operationId: 'ping',
        responses: { '204': { description: 'Pong' } },
      },
    },
    '/upload': {
      post: {
        operationId: 'upload',
        requestBody: {
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
        responses: { '204': { description: 'Uploaded' } },
      },
    },
  },
};

async function operations() {
  const ir = await toIR({ spec: document });
  const byId: Record<string, TunedOperationObject> = {};
  forEachOperation(ir, (_entry, operation) => {
    byId[operation.operationId] = operation;
  });
  return { ir, byId };
}

function sorted(values: readonly string[] | undefined) {
  return [...(values ?? [])].sort();
}

function propertyNames(schema: OperationInput['schema']) {
  return sorted(Object.keys(schema.properties ?? {}));
}

function sending({ schema: _schema, ...input }: OperationInput) {
  return input;
}

test('operationInputs prefers JSON over XML, offers XML as a text variant, and places each input where the request carries it', async () => {
  const { ir, byId } = await operations();

  const [preferred, ...variants] = operationInputs(ir, byId.updateChat);

  assert.deepStrictEqual(sending(preferred), {
    preferred: true,
    contentType: 'application/json',
    encoding: 'json',
    header: ['x-trace'],
    query: ['draft'],
    body: ['content', 'note'],
    path: ['chatId'],
  });
  assert.deepStrictEqual(
    variants.map(({ preferred, contentType, encoding }) => [
      preferred,
      contentType,
      encoding,
    ]),
    [[false, 'application/xml', 'text']],
  );
});

test('the input schema folds parameters into the body fields and keeps every required name', async () => {
  const { ir, byId } = await operations();

  const [{ schema }] = operationInputs(ir, byId.updateChat);

  assert.deepStrictEqual(propertyNames(schema), [
    'chatId',
    'content',
    'draft',
    'note',
    'x-trace',
  ]);
  assert.deepStrictEqual(sorted(schema.required), [
    'chatId',
    'content',
    'x-trace',
  ]);
});

test('a non-object body is the $body input, required only when the request body is', async () => {
  const { ir, byId } = await operations();

  const [required] = operationInputs(ir, byId.writeLogs);
  const [optional] = operationInputs(ir, byId.writeDrafts);

  assert.deepStrictEqual(propertyNames(required.schema), ['$body']);
  const body = required.schema.properties?.$body;
  assert.ok(body && !('$ref' in body));
  assert.deepStrictEqual([body.type, body.items], [logs.type, logs.items]);
  assert.deepStrictEqual(sorted(required.schema.required), ['$body']);
  assert.deepStrictEqual(sorted(optional.schema.required), []);
  assert.deepStrictEqual(required.body, ['$body']);
});

test('an operation without a body sends an empty request and accepts any input', async () => {
  const { ir, byId } = await operations();

  const inputs = operationInputs(ir, byId.ping);

  assert.deepStrictEqual(inputs.map(sending), [
    {
      preferred: true,
      contentType: 'application/empty',
      encoding: 'empty',
      header: [],
      query: [],
      body: [],
      path: [],
    },
  ]);
  assert.equal(inputs[0].schema.additionalProperties, true);
});

test('a body in a binary media type is the $body Blob input, sent with that media type', async () => {
  const { ir, byId } = await operations();

  const inputs = operationInputs(ir, byId.upload);

  assert.deepStrictEqual(inputs.map(sending), [
    {
      preferred: true,
      contentType: 'application/octet-stream',
      encoding: 'binary',
      header: [],
      query: [],
      body: ['$body'],
      path: [],
    },
  ]);
  const body = inputs[0].schema.properties?.$body;
  assert.ok(body && !('$ref' in body));
  assert.deepStrictEqual([body.type, body.format], ['string', 'binary']);
});
