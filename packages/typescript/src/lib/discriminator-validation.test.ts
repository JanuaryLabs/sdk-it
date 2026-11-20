import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

function answer(
  value: string,
  extra: Record<string, SchemaObject> = {},
): SchemaObject {
  return {
    type: 'object',
    properties: { answer: { type: 'string', const: value }, ...extra },
    required: ['answer', ...Object.keys(extra)],
  };
}

const patients: OpenAPIObject = {
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
                      answer('none'),
                      answer('yes', {
                        entries: {
                          type: 'array',
                          items: { type: 'string' },
                          minItems: 1,
                        },
                      }),
                      answer('skip'),
                    ],
                    discriminator: { propertyName: 'answer' },
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

void test('a discriminated oneOf refuses an unknown discriminator value at the discriminator', async () => {
  await using workspace = await workspaceDirectory('discriminated-union-');
  await generate(patients, {
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

  await assert.rejects(
    client.request('POST /patients', {
      kind: 'intake',
      medications: { answer: 'maybe' },
    }),
    (error: {
      name: string;
      data: { fieldErrors: { medications: { path: unknown[] }[] } };
    }) => {
      assert.equal(error.name, 'ParseError');
      assert.deepEqual(
        error.data.fieldErrors.medications.map((issue) => issue.path),
        [['medications', 'answer']],
      );
      return true;
    },
  );
  await assert.doesNotReject(
    client.request('POST /patients', {
      kind: 'intake',
      medications: { answer: 'yes', entries: ['a'] },
    }),
  );
});

void test('a discriminator whose branches declare no literal value still validates as oneOf', async () => {
  const pets: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        post: {
          operationId: 'addPet',
          tags: ['pets'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/Cat' },
                    { $ref: '#/components/schemas/Dog' },
                  ],
                  discriminator: {
                    propertyName: 'petType',
                    mapping: {
                      cat: '#/components/schemas/Cat',
                      dog: '#/components/schemas/Dog',
                    },
                  },
                },
              },
            },
          },
          responses: { '204': { description: 'Added' } },
        },
      },
    },
    components: {
      schemas: {
        Cat: {
          type: 'object',
          properties: {
            petType: { type: 'string' },
            lives: { type: 'integer' },
          },
          required: ['petType', 'lives'],
        },
        Dog: {
          type: 'object',
          properties: {
            petType: { type: 'string' },
            bark: { type: 'boolean' },
          },
          required: ['petType', 'bark'],
        },
      },
    },
  };
  await using workspace = await workspaceDirectory('discriminator-mapping-');
  await generate(pets, {
    output: workspace.path,
    name: 'Pets',
    packageName: '@acme/pets',
    readme: false,
    mode: 'full',
  });
  const { createPets } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createPets({
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });

  await assert.doesNotReject(
    client.request('POST /pets', { $body: { petType: 'cat', lives: 9 } }),
  );
});
