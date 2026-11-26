import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { parseErrorFor, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Patients', version: '1.0.0' },
  paths: {
    '/patients': {
      post: {
        operationId: 'recordIntake',
        tags: ['patients'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'intake' },
                  medications: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          answer: { type: 'string', const: 'none' },
                        },
                        required: ['answer'],
                      },
                      {
                        type: 'object',
                        properties: {
                          answer: { type: 'string', const: 'yes' },
                          entries: {
                            type: 'array',
                            items: { type: 'string' },
                            minItems: 1,
                          },
                        },
                        required: ['answer', 'entries'],
                      },
                      {
                        type: 'object',
                        properties: {
                          answer: { type: 'string', const: 'skip' },
                        },
                        required: ['answer'],
                      },
                    ],
                  },
                },
                required: ['kind', 'medications'],
              },
            },
          },
        },
        responses: { '204': { description: 'Recorded' } },
      },
    },
  },
};

void test('a const property the input leaves out is refused, not filled with its value', async () => {
  // Arrange
  await using workspace = await workspaceDirectory('const-no-default-');
  await generate(spec, {
    output: workspace.path,
    name: 'Patients',
    packageName: '@acme/patients',
    readme: false,
    mode: 'full',
  });
  const { createPatients } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createPatients({
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });

  // Act and assert
  await assert.rejects(
    client.request('POST /patients', { kind: 'intake', medications: {} }),
    parseErrorFor('medications'),
  );
  await assert.rejects(
    client.request('POST /patients', { medications: { answer: 'none' } }),
    parseErrorFor('kind'),
  );
  await assert.doesNotReject(
    client.request('POST /patients', {
      kind: 'intake',
      medications: { answer: 'none' },
    }),
  );
});
