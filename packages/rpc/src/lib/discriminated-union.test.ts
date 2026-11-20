import { TemporaryFiles } from '@zukhruf/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';

function answer(value: string, extra: Record<string, object> = {}) {
  return {
    type: 'object',
    properties: { answer: { type: 'string', const: value }, ...extra },
    required: ['answer', ...Object.keys(extra)],
  };
}

const patients = {
  openapi: '3.1.0',
  info: { title: 'Patients', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
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

const pets = {
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
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

test('a discriminated oneOf refuses an unknown discriminator value at the discriminator', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-discriminated-');
  const specPath = join(dir.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(patients));
  const client = await rpc(specPath, {
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

test('a discriminator whose branches declare no literal value still validates as oneOf', async () => {
  await using dir = await new TemporaryFiles().directory(
    'rpc-discriminator-mapping-',
  );
  const specPath = join(dir.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(pets));
  const client = await rpc(specPath, {
    fetch: async () => new Response(null, { status: 204 }),
  });

  await assert.doesNotReject(
    client.request('POST /pets', { $body: { petType: 'cat', lives: 9 } }),
  );
});

function things(
  value: object,
  schemas: Record<string, object> = {},
  openapi = '3.1.0',
) {
  return {
    openapi,
    info: { title: 'Things', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
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

async function clientOf(dir: { path: string }, document: object) {
  const specPath = join(dir.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(document));
  return rpc(specPath, {
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

test('a discriminated oneOf refuses an input without the discriminator at the discriminator', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-missing-');
  const client = await clientOf(dir, patients);

  await assert.rejects(
    client.request('POST /patients', { kind: 'intake', medications: {} }),
    refusedAt('medications', ['medications', 'answer']),
  );
});

test('a mapping-only discriminator refuses an input that matches more than one branch', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-exclusive-');
  const client = await clientOf(dir, pets);

  await assert.rejects(
    client.request('POST /pets', {
      $body: { petType: 'cat', lives: 9, bark: true },
    }),
    (error: { name: string }) => error.name === 'ParseError',
  );
  await assert.doesNotReject(
    client.request('POST /pets', { $body: { petType: 'cat', lives: 9 } }),
  );
});

test('branches that share a discriminator value validate as oneOf', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-overlap-');
  const client = await clientOf(
    dir,
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

test('a branch that does not require the discriminator accepts an input without it', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-optional-');
  const client = await clientOf(
    dir,
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

test('a branch typed object or null accepts null', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-null-');
  const client = await clientOf(
    dir,
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

test('an OpenAPI 3.0 nullable branch accepts null', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-nullable-');
  const client = await clientOf(
    dir,
    things(
      {
        oneOf: [
          {
            type: 'object',
            nullable: true,
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

test('a branch with a default accepts a valid input', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-default-');
  const client = await clientOf(
    dir,
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

test('a discriminator given by an enum refuses an unknown value at the discriminator', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-enum-');
  const client = await clientOf(
    dir,
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

test('a discriminated anyOf refuses an unknown value at the discriminator', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-anyof-');
  const client = await clientOf(
    dir,
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

test('a discriminator whose const is not a literal validates as oneOf', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-object-');
  const client = await clientOf(
    dir,
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

test('referenced branches, one recursive, refuse an unknown value at the discriminator', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-disc-recursive-');
  const client = await clientOf(
    dir,
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
