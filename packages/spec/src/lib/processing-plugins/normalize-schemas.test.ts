import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { normalizeSchemas, processSpec } from '@sdk-it/spec';

test('schema normalization preserves the established recursive IR repairs', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Schemas', version: '1.0.0' },
      components: {
        schemas: {
          Payload: {
            properties: {
              count: { type: 'number' },
              status: { type: 'string', enum: ['ready'] },
            },
            default: { count: 3 },
          },
          Items: {
            items: {
              type: 'string',
              default: ['first', 'second'],
            },
          },
          Choice: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
          Dictionary: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['ready'] },
              },
            },
          },
        },
      },
      paths: {},
    },
    plugins: [normalizeSchemas()],
  });

  assert.deepStrictEqual(spec.components.schemas.Payload, {
    type: 'object',
    properties: {
      count: { type: 'number', default: 3 },
      status: { type: 'string', const: 'ready', default: 'ready' },
    },
  });
  assert.deepStrictEqual(spec.components.schemas.Items, {
    type: 'array',
    items: { type: 'string' },
    default: ['first', 'second'],
  });
  assert.deepStrictEqual(spec.components.schemas.Choice, { type: 'string' });

  const dictionary = spec.components.schemas.Dictionary as SchemaObject;
  assert.ok(
    typeof dictionary.additionalProperties === 'object' &&
      !('$ref' in dictionary.additionalProperties),
  );
  assert.deepStrictEqual(dictionary.additionalProperties.properties, {
    status: { type: 'string', const: 'ready', default: 'ready' },
  });
});

test('schema normalization reports circular allOf references without overflowing', async () => {
  await assert.rejects(
    processSpec({
      spec: {
        openapi: '3.1.0',
        info: { title: 'Schemas', version: '1.0.0' },
        components: {
          schemas: {
            A: { allOf: [{ $ref: '#/components/schemas/B' }] },
            B: { allOf: [{ $ref: '#/components/schemas/A' }] },
          },
        },
        paths: {},
      },
      plugins: [normalizeSchemas()],
    }),
    {
      name: 'Error',
      message:
        'Circular allOf reference detected: #/components/schemas/B -> #/components/schemas/A -> #/components/schemas/B',
    },
  );
});
