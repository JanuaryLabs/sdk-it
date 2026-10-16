import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core';
import { toIR } from '@sdk-it/spec';

void test.each(
  ['inline', 'reference', 'array item', 'nested'] as const,
  (shape) =>
    test.each([false, true], (nullFirst) =>
      test(`schema pipeline preserves nullable ${shape} objects with null ${nullFirst ? 'first' : 'last'}`, async () => {
        const details: SchemaObject = {
          type: nullFirst ? ['null', 'object'] : ['object', 'null'],
          properties: { id: { type: 'string' } },
          required: ['id'],
        };
        const field =
          shape === 'reference'
            ? { $ref: '#/components/schemas/Details' }
            : shape === 'array item'
              ? { type: 'array' as const, items: details }
              : shape === 'nested'
                ? {
                    type: 'object' as const,
                    properties: { child: details },
                    required: ['child'],
                  }
                : details;
        const ir = await toIR({
          spec: {
            openapi: '3.1.0',
            info: { title: 'Nullable objects', version: '1.0.0' },
            components: {
              schemas: {
                Details: details,
                Payload: {
                  type: 'object',
                  properties: { requiredRecord: field, optionalRecord: field },
                  required: ['requiredRecord'],
                },
              },
            },
            paths: {
              '/records': {
                get: {
                  operationId: 'readRecords',
                  responses: {
                    '200': {
                      description: 'Records',
                      content: {
                        'application/json': {
                          schema: { $ref: '#/components/schemas/Payload' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        const payload = resolveRef<SchemaObject>(
          ir,
          ir.components.schemas.Payload,
        );
        assert.deepEqual(payload.required, ['requiredRecord']);
        assert.ok(payload.properties);
        for (const field of Object.values(payload.properties)) {
          const resolved = resolveRef<SchemaObject>(ir, field);
          const record =
            shape === 'array item'
              ? resolved.items
              : shape === 'nested'
                ? resolved.properties?.child
                : resolved;
          assert.ok(record);
          const normalized = resolveRef<SchemaObject>(ir, record);
          assert.deepEqual(normalized.type, details.type);
          assert.deepEqual(normalized.required, ['id']);
          assert.partialDeepStrictEqual(normalized.properties, {
            id: { type: 'string' },
          });
        }
      }),
    ),
);
