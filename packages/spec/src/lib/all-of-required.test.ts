import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { toIR } from '@sdk-it/spec';

test('allOf keeps the required properties of every part', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Spaces', version: '1.0.0' },
      components: {
        schemas: {
          Audited: {
            type: 'object',
            properties: { createdAt: { type: 'string' } },
            required: ['createdAt'],
          },
          Space: {
            allOf: [
              {
                type: 'object',
                properties: { _count: { type: 'number' } },
                required: ['_count'],
              },
              {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                },
                required: ['id', 'name'],
              },
            ],
          },
          Member: {
            allOf: [
              { $ref: '#/components/schemas/Audited' },
              {
                type: 'object',
                properties: { email: { type: 'string' } },
                required: ['email'],
              },
            ],
          },
          Team: {
            type: 'object',
            properties: {
              owner: {
                allOf: [
                  {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                  },
                  {
                    type: 'object',
                    properties: { email: { type: 'string' } },
                    required: ['email'],
                  },
                ],
              },
            },
            required: ['owner'],
          },
        },
      },
      paths: {
        '/spaces': {
          get: {
            operationId: 'listSpaces',
            responses: {
              '200': {
                description: 'Spaces',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        space: { $ref: '#/components/schemas/Space' },
                        member: { $ref: '#/components/schemas/Member' },
                        team: { $ref: '#/components/schemas/Team' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const schemas = ir.components.schemas as Record<string, SchemaObject>;
  const owner = schemas['Team'].properties?.['owner'] as SchemaObject;

  assert.deepEqual(schemas['Space'].required?.toSorted(), [
    '_count',
    'id',
    'name',
  ]);
  assert.deepEqual(schemas['Member'].required?.toSorted(), [
    'createdAt',
    'email',
  ]);
  assert.deepEqual(owner.required?.toSorted(), ['email', 'id']);
});
