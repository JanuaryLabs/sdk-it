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

function things(
  value: SchemaObject,
  schemas: Record<string, SchemaObject> = {},
  openapi = '3.1.0',
): OpenAPIObject {
  return {
    openapi,
    info: { title: 'Things', version: '1.0.0' },
    paths: {
      '/things': {
        post: {
          operationId: 'putThing',
          tags: ['things'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { value },
                  required: ['value'],
                },
              },
            },
          },
          responses: { '204': { description: 'Stored' } },
        },
      },
    },
    components: { schemas },
  };
}

async function clientOf(
  workspace: { path: string },
  document: OpenAPIObject,
): Promise<{
  request: (endpoint: string, input: unknown) => Promise<unknown>;
}> {
  await generate(document, {
    output: workspace.path,
    name: 'Things',
    packageName: '@acme/things',
    readme: false,
    mode: 'full',
  });
  const { createThings } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  return createThings({
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });
}

function refusedAt(field: string, ...paths: unknown[][]) {
  return (error: {
    name: string;
    data: { fieldErrors: Record<string, { path: unknown[] }[]> };
  }) => {
    assert.equal(error.name, 'ParseError');
    assert.deepEqual(
      error.data.fieldErrors[field]?.map((issue) => issue.path),
      paths,
    );
    return true;
  };
}

void test('a discriminated oneOf refuses an input without the discriminator at the discriminator', async () => {
  await using workspace = await workspaceDirectory('discriminator-missing-');
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
    client.request('POST /patients', { kind: 'intake', medications: {} }),
    refusedAt('medications', ['medications', 'answer']),
  );
});

void test('a mapping-only discriminator refuses an input that matches more than one branch', async () => {
  await using workspace = await workspaceDirectory('discriminator-exclusive-');
  const client = await clientOf(
    workspace,
    things(
      {
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
      {
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
    ),
  );

  await assert.rejects(
    client.request('POST /things', {
      value: { petType: 'cat', lives: 9, bark: true },
    }),
    refusedAt('value', ['value']),
  );
  await assert.doesNotReject(
    client.request('POST /things', { value: { petType: 'cat', lives: 9 } }),
  );
});

void test('branches that share a discriminator value validate as oneOf', async () => {
  await using workspace = await workspaceDirectory('discriminator-overlap-');
  const client = await clientOf(
    workspace,
    things({
      oneOf: [
        {
          type: 'object',
          properties: { k: { const: 'a' }, x: { type: 'string' } },
          required: ['k', 'x'],
        },
        {
          type: 'object',
          properties: { k: { const: 'a' }, y: { type: 'number' } },
          required: ['k', 'y'],
        },
      ],
      discriminator: { propertyName: 'k' },
    }),
  );

  await assert.doesNotReject(
    client.request('POST /things', { value: { k: 'a', x: 's' } }),
  );
});

void test('a branch that does not require the discriminator accepts an input without it', async () => {
  await using workspace = await workspaceDirectory('discriminator-optional-');
  const client = await clientOf(
    workspace,
    things({
      oneOf: [
        { type: 'object', properties: { k: { const: 'a' } } },
        {
          type: 'object',
          properties: { k: { const: 'b' }, y: { type: 'number' } },
          required: ['k', 'y'],
        },
      ],
      discriminator: { propertyName: 'k' },
    }),
  );

  await assert.doesNotReject(client.request('POST /things', { value: {} }));
});

void test('a branch typed object or null accepts null', async () => {
  await using workspace = await workspaceDirectory('discriminator-null-');
  const client = await clientOf(
    workspace,
    things({
      oneOf: [
        {
          type: ['object', 'null'],
          properties: { k: { const: 'a' } },
          required: ['k'],
        },
        {
          type: 'object',
          properties: { k: { const: 'b' } },
          required: ['k'],
        },
      ],
      discriminator: { propertyName: 'k' },
    }),
  );

  await assert.doesNotReject(client.request('POST /things', { value: null }));
});

void test('an OpenAPI 3.0 nullable branch accepts null', async () => {
  await using workspace = await workspaceDirectory('discriminator-nullable-');
  const openapi30Nullable = { nullable: true };
  const client = await clientOf(
    workspace,
    things(
      {
        oneOf: [
          {
            ...openapi30Nullable,
            type: 'object',
            properties: { k: { type: 'string', enum: ['a'] } },
            required: ['k'],
          },
          {
            type: 'object',
            properties: { k: { type: 'string', enum: ['b'] } },
            required: ['k'],
          },
        ],
        discriminator: { propertyName: 'k' },
      },
      {},
      '3.0.3',
    ),
  );

  await assert.doesNotReject(client.request('POST /things', { value: null }));
});

void test('a branch with a default accepts a valid input', async () => {
  await using workspace = await workspaceDirectory('discriminator-default-');
  const client = await clientOf(
    workspace,
    things({
      oneOf: [
        {
          type: 'object',
          properties: { k: { const: 'a' } },
          required: ['k'],
          default: { k: 'a' },
        },
        {
          type: 'object',
          properties: { k: { const: 'b' } },
          required: ['k'],
        },
      ],
      discriminator: { propertyName: 'k' },
    }),
  );

  await assert.doesNotReject(
    client.request('POST /things', { value: { k: 'a' } }),
  );
});

void test('a discriminator given by an enum refuses an unknown value at the discriminator', async () => {
  await using workspace = await workspaceDirectory('discriminator-enum-');
  const client = await clientOf(
    workspace,
    things({
      oneOf: [
        {
          type: 'object',
          properties: { k: { type: 'string', enum: ['a', 'b'] } },
          required: ['k'],
        },
        {
          type: 'object',
          properties: { k: { type: 'string', enum: ['c'] } },
          required: ['k'],
        },
      ],
      discriminator: { propertyName: 'k' },
    }),
  );

  await assert.rejects(
    client.request('POST /things', { value: { k: 'z' } }),
    refusedAt('value', ['value', 'k']),
  );
});

void test('a discriminated anyOf refuses an unknown value at the discriminator', async () => {
  await using workspace = await workspaceDirectory('discriminator-anyof-');
  const client = await clientOf(
    workspace,
    things({
      anyOf: [answer('none'), answer('skip')],
      discriminator: { propertyName: 'answer' },
    }),
  );

  await assert.rejects(
    client.request('POST /things', { value: { answer: 'maybe' } }),
    refusedAt('value', ['value', 'answer']),
  );
});

void test('a discriminator whose const is not a literal validates as oneOf', async () => {
  await using workspace = await workspaceDirectory('discriminator-object-');
  const client = await clientOf(
    workspace,
    things({
      oneOf: [
        {
          type: 'object',
          properties: { k: { const: { x: 1 } } },
          required: ['k'],
        },
        {
          type: 'object',
          properties: { k: { const: 'b' } },
          required: ['k'],
        },
      ],
      discriminator: { propertyName: 'k' },
    }),
  );

  await assert.doesNotReject(
    client.request('POST /things', { value: { k: 'b' } }),
  );
  await assert.rejects(
    client.request('POST /things', { value: { k: 'z' } }),
    refusedAt('value', ['value']),
  );
});

void test('referenced branches, one recursive, refuse an unknown value at the discriminator', async () => {
  await using workspace = await workspaceDirectory('discriminator-recursive-');
  const client = await clientOf(
    workspace,
    things(
      {
        oneOf: [
          { $ref: '#/components/schemas/Folder' },
          { $ref: '#/components/schemas/File' },
        ],
        discriminator: { propertyName: 'kind' },
      },
      {
        Folder: {
          type: 'object',
          properties: {
            kind: { const: 'folder' },
            parent: { $ref: '#/components/schemas/Folder' },
          },
          required: ['kind'],
        },
        File: {
          type: 'object',
          properties: { kind: { const: 'file' } },
          required: ['kind'],
        },
      },
    ),
  );

  await assert.rejects(
    client.request('POST /things', { value: { kind: 'link' } }),
    refusedAt('value', ['value', 'kind']),
  );
  await assert.doesNotReject(
    client.request('POST /things', {
      value: { kind: 'folder', parent: { kind: 'folder' } },
    }),
  );
});
