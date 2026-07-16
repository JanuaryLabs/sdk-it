import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type IR, normalizeRequestBodies, processSpec } from '@sdk-it/spec';

function schemaForRef(spec: IR, ref: string | undefined) {
  assert.ok(ref);
  const schema = spec.components.schemas[ref.split('/').at(-1) as string];
  assert.ok(!('$ref' in schema));
  return schema;
}

test('request body media types receive independent component schemas', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Requests', version: '1.0.0' },
      paths: {
        '/documents': {
          post: {
            operationId: 'createDocument',
            parameters: [],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { jsonValue: { type: 'string' } },
                  },
                },
                'application/xml': {
                  schema: {
                    type: 'object',
                    properties: { xmlValue: { type: 'string' } },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    },
    plugins: [normalizeRequestBodies()],
  });

  const content = spec.paths['/documents'].post?.requestBody;
  assert.ok(content && !('$ref' in content));
  const jsonSchema = content.content['application/json'].schema;
  const xmlSchema = content.content['application/xml'].schema;
  assert.ok(jsonSchema && '$ref' in jsonSchema);
  assert.ok(xmlSchema && '$ref' in xmlSchema);
  assert.notStrictEqual(jsonSchema.$ref, xmlSchema.$ref);
  assert.deepStrictEqual(schemaForRef(spec, jsonSchema.$ref).properties, {
    jsonValue: { type: 'string' },
  });
  assert.deepStrictEqual(schemaForRef(spec, xmlSchema.$ref).properties, {
    xmlValue: { type: 'string' },
  });
});

test('referenced request bodies are isolated per operation', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Requests', version: '1.0.0' },
      components: {
        requestBodies: {
          SharedBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { value: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      paths: {
        '/first': {
          post: {
            operationId: 'createFirst',
            parameters: [
              { in: 'query', name: 'first', schema: { type: 'string' } },
            ],
            requestBody: { $ref: '#/components/requestBodies/SharedBody' },
            responses: {},
          },
        },
        '/second': {
          post: {
            operationId: 'createSecond',
            parameters: [
              { in: 'query', name: 'second', schema: { type: 'string' } },
            ],
            requestBody: { $ref: '#/components/requestBodies/SharedBody' },
            responses: {},
          },
        },
      },
    },
    plugins: [normalizeRequestBodies()],
  });

  const firstBody = spec.paths['/first'].post?.requestBody;
  const secondBody = spec.paths['/second'].post?.requestBody;
  assert.ok(firstBody && !('$ref' in firstBody));
  assert.ok(secondBody && !('$ref' in secondBody));
  const firstSchema = firstBody.content['application/json'].schema;
  const secondSchema = secondBody.content['application/json'].schema;
  assert.ok(firstSchema && '$ref' in firstSchema);
  assert.ok(secondSchema && '$ref' in secondSchema);

  assert.deepStrictEqual(spec.components.requestBodies?.SharedBody, {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { value: { type: 'string' } },
        },
      },
    },
  });
  assert.deepStrictEqual(
    Object.keys(schemaForRef(spec, firstSchema.$ref)['x-properties']),
    ['first'],
  );
  assert.deepStrictEqual(
    Object.keys(schemaForRef(spec, secondSchema.$ref)['x-properties']),
    ['second'],
  );
});
