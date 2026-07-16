import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResponseObject } from 'openapi3-ts/oas31';

import { type IR, normalizeResponses, processSpec } from '@sdk-it/spec';

function schemaForRef(spec: IR, ref: string | undefined) {
  assert.ok(ref);
  const schema = spec.components.schemas[ref.split('/').at(-1) as string];
  assert.ok(!('$ref' in schema));
  return schema;
}

test('response media types receive independent component schemas', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Responses', version: '1.0.0' },
      paths: {
        '/events': {
          get: {
            operationId: 'getEvents',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { items: { type: 'array', items: {} } },
                    },
                  },
                  'text/event-stream': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    plugins: [normalizeResponses()],
  });

  const response = spec.paths['/events'].get?.responses?.[
    '200'
  ] as ResponseObject;
  const jsonSchema = response.content?.['application/json'].schema;
  const eventSchema = response.content?.['text/event-stream'].schema;
  assert.ok(jsonSchema && '$ref' in jsonSchema);
  assert.ok(eventSchema && '$ref' in eventSchema);
  assert.notStrictEqual(jsonSchema.$ref, eventSchema.$ref);
  assert.deepStrictEqual(schemaForRef(spec, jsonSchema.$ref).properties, {
    items: { type: 'array', items: {} },
  });
  assert.strictEqual(schemaForRef(spec, jsonSchema.$ref)['x-sse'], undefined);
  assert.strictEqual(schemaForRef(spec, eventSchema.$ref)['x-sse'], true);
});

test('success response ranges and default responses are preserved', async () => {
  const { spec, diagnostics } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Responses', version: '1.0.0' },
      paths: {
        '/jobs': {
          get: {
            operationId: 'getJobs',
            responses: {
              '2XX': { description: 'Any successful response' },
              default: { description: 'Unexpected response' },
            },
          },
        },
      },
    },
    plugins: [normalizeResponses()],
  });

  const responses = spec.paths['/jobs'].get?.responses ?? {};
  assert.deepStrictEqual(Object.keys(responses), ['2XX', 'default']);
  assert.strictEqual(diagnostics.length, 0);
});
