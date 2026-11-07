import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

function jsonBody(schema: SchemaObject | { $ref: string }) {
  return {
    required: true,
    content: { 'application/json': { schema } },
  };
}

const noContent = { '204': { description: 'No Content' } };

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  servers: [{ url: 'https://pets.test' }],
  components: {
    schemas: {
      Owner: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      Pet: {
        type: 'object',
        required: ['owner'],
        properties: { owner: { $ref: '#/components/schemas/Owner' } },
      },
      Toy: {
        type: 'object',
        properties: {
          Owner: { type: 'string' },
          kind: { type: 'string', enum: ['Owner', 'Ball'] },
        },
      },
      Tag: {
        type: 'object',
        properties: { Label: { type: 'string' } },
      },
      Label: {
        type: 'object',
        properties: { Tag: { type: 'string' } },
      },
    },
  },
  paths: {
    '/pets': {
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        requestBody: jsonBody({
          type: 'object',
          properties: { pet: { $ref: '#/components/schemas/Pet' } },
        }),
        responses: noContent,
      },
    },
    '/toys': {
      post: {
        operationId: 'createToy',
        tags: ['toys'],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            toy: { $ref: '#/components/schemas/Toy' },
            Owner: { type: 'string' },
          },
        }),
        responses: noContent,
      },
    },
    '/tags': {
      post: {
        operationId: 'createTag',
        tags: ['tags'],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            tag: { $ref: '#/components/schemas/Tag' },
            label: { $ref: '#/components/schemas/Label' },
          },
        }),
        responses: noContent,
      },
    },
  },
};

async function generated() {
  const workspace = await workspaceDirectory('input-imports-');
  await generate(spec, {
    output: workspace.path,
    name: 'Pets',
    packageName: '@acme/pets',
    readme: false,
    mode: 'full',
  });
  return workspace;
}

/** The names a generated file imports from other files. */
async function importedNames(path: string) {
  const content = await readFile(path, 'utf-8');
  return [...content.matchAll(/^import \{ (\w+) \} from '\.\//gm)].map(
    ([, name]) => name,
  );
}

void test('a shared input schema whose property key and enum value spell another schema name does not import that schema', async () => {
  await using workspace = await generated();

  assert.deepEqual(
    await importedNames(join(workspace.path, 'src/inputs/schemas/toy.ts')),
    [],
  );
});

void test('an inputs file whose input has a property key that spells a schema name imports only the schemas the input references', async () => {
  await using workspace = await generated();

  assert.deepEqual(
    await importedNames(join(workspace.path, 'src/inputs/toys.ts')),
    ['Toy'],
  );
});

void test('two shared schemas that spell each other names without referencing each other import nothing from each other', async () => {
  await using workspace = await generated();

  assert.deepEqual(
    await importedNames(join(workspace.path, 'src/inputs/schemas/tag.ts')),
    [],
  );
  assert.deepEqual(
    await importedNames(join(workspace.path, 'src/inputs/schemas/label.ts')),
    [],
  );
});

void test('a shared input schema that references another schema imports it, and the SDK parses and type-checks', async () => {
  await using workspace = await generated();
  const { createPetSchema, createToySchema } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );

  const pet = createPetSchema.parse({ pet: { owner: { name: 'Ada' } } });
  const toy = createToySchema.parse({ toy: { kind: 'Owner' }, Owner: 'Ada' });

  assert.deepEqual(
    await importedNames(join(workspace.path, 'src/inputs/schemas/pet.ts')),
    ['Owner'],
  );
  assert.deepEqual(pet, { pet: { owner: { name: 'Ada' } } });
  assert.deepEqual(toy, { toy: { kind: 'Owner' }, Owner: 'Ada' });
  assert.throws(() => createPetSchema.parse({ pet: { owner: {} } }));
  assert.deepEqual(
    typecheck(join(workspace.path, 'tsconfig.json')).diagnostics,
    [],
  );
});
