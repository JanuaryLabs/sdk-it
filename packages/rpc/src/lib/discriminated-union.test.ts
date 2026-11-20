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
