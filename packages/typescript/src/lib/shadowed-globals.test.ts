import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Calendar', version: '1.0.0' },
  servers: [{ url: 'https://calendar.test' }],
  components: {
    schemas: {
      Date: {
        type: 'object',
        required: ['day'],
        properties: { day: { type: 'integer' } },
      },
      Filter: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            format: 'date-time',
            'x-zod-type': 'coerce-date',
            default: '2024-01-02T03:04:05.000Z',
          },
          on: { $ref: '#/components/schemas/Date' },
        },
      },
    },
  },
  paths: {
    '/events/search': {
      post: {
        operationId: 'searchEvents',
        tags: ['events'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Filter' },
            },
          },
        },
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
};

void test('a spec schema named Date leaves the global Date to the inputs that use it: a date default parses to a Date and the SDK type-checks', async () => {
  await using workspace = await workspaceDirectory('shadowed-globals-');
  await generate(spec, {
    output: workspace.path,
    name: 'Calendar',
    packageName: '@acme/calendar',
    readme: false,
    mode: 'full',
  });
  const { searchEventsSchema } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );

  const input = searchEventsSchema.parse({ on: { day: 2 } });

  assert.deepEqual(input.since, new Date('2024-01-02T03:04:05.000Z'));
  assert.deepEqual(
    typecheck(join(workspace.path, 'tsconfig.json')).diagnostics,
    [],
  );
});
