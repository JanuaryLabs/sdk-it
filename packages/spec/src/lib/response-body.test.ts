import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResponseObject } from 'openapi3-ts/oas31';

import { type TunedOperationObject, toIR } from '@sdk-it/spec';

const cases: [string, ResponseObject, string][] = [
  [
    'a JSON body',
    {
      description: 'OK',
      content: { 'application/json': { schema: { type: 'object' } } },
    },
    'json',
  ],
  ['a text body', { description: 'OK', content: { 'text/plain': {} } }, 'text'],
  ['an image', { description: 'OK', content: { 'image/png': {} } }, 'binary'],
  [
    'an octet-stream download',
    {
      description: 'OK',
      headers: { 'Content-Disposition': { schema: { type: 'string' } } },
      content: { 'application/octet-stream': {} },
    },
    'binary',
  ],
  [
    'an octet-stream',
    { description: 'OK', content: { 'application/octet-stream': {} } },
    'stream',
  ],
  [
    'a chunked JSON body',
    {
      description: 'OK',
      headers: { 'Transfer-Encoding': { schema: { type: 'string' } } },
      content: { 'application/json': { schema: { type: 'object' } } },
    },
    'stream',
  ],
  [
    'an unclassifiable media type',
    { description: 'OK', content: { 'application/vnd.acme': {} } },
    'stream',
  ],
  [
    'server-sent events',
    { description: 'OK', content: { 'text/event-stream': {} } },
    'sse',
  ],
  [
    'server-sent events with a referenced schema',
    {
      description: 'OK',
      content: {
        'text/event-stream': {
          schema: { $ref: '#/components/schemas/Event' },
        },
      },
    },
    'sse',
  ],
  [
    'the first classifiable media type',
    {
      description: 'OK',
      content: {
        'application/vnd.acme': {},
        'text/plain': {},
        'application/json': { schema: { type: 'object' } },
      },
    },
    'text',
  ],
  ['no content', { description: 'Created' }, 'empty'],
];

for (const [shape, response, expected] of cases) {
  test(`a response with ${shape} has body kind ${expected}`, async () => {
    const ir = await toIR({
      spec: {
        openapi: '3.1.0',
        info: { title: 'Bodies', version: '1.0.0' },
        components: {
          schemas: {
            Event: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
        paths: {
          '/things': {
            post: {
              operationId: 'createThing',
              responses: { '201': structuredClone(response) },
            },
          },
        },
      },
    });
    const operation = ir.paths['/things']?.post as TunedOperationObject;

    assert.equal(operation.responses['201']['x-body'], expected);
  });
}

test('a response with no content gets no fabricated body or output', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Bodies', version: '1.0.0' },
      paths: {
        '/things': {
          post: {
            operationId: 'createThing',
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    },
  });
  const created = (ir.paths['/things']?.post as TunedOperationObject).responses[
    '201'
  ];

  assert.deepEqual(created.content, {});
  assert.equal(created['x-response-name'], undefined);
});

test('an error response that is not flattened still has a body kind', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Bodies', version: '1.0.0' },
      paths: {
        '/things': {
          get: {
            operationId: 'listThings',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'array' } } },
              },
              '404': {
                description: 'Missing',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    },
  });
  const operation = ir.paths['/things']?.get as TunedOperationObject;

  assert.equal(operation.responses['404']['x-body'], 'json');
});
