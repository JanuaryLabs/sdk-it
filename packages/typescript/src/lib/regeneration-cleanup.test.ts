import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const withOperations: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets': {
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { id: { type: 'string' } },
                  required: ['id'],
                },
              },
            },
          },
        },
      },
    },
  },
};

const withoutOperations: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {},
};

const settingsFor = (output: string) => ({
  name: 'Pets',
  packageName: '@acme/pets',
  output,
  readme: false,
  mode: 'full' as const,
});

function addUserBarrel(src: string) {
  mkdirSync(join(src, 'models', 'extra'));
  writeFileSync(
    join(src, 'models', 'extra', 'extra.ts'),
    'export type Extra = 1;\n',
  );
  writeFileSync(
    join(src, 'models', 'extra', 'index.ts'),
    "export * from './extra.ts';\n",
  );
}

void test('a user index.ts that metadata.json userFiles declares survives regeneration and stays exported', async () => {
  // Arrange
  await using directory = await workspaceDirectory('cleanup-declared-index-');
  const src = join(directory.path, 'src');
  await generate(withOperations, settingsFor(directory.path));
  addUserBarrel(src);
  const metadataPath = join(src, 'metadata.json');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  metadata.userFiles.push('/models/extra/**');
  writeFileSync(metadataPath, JSON.stringify(metadata));

  // Act
  await generate(withOperations, settingsFor(directory.path));

  // Assert
  assert.equal(existsSync(join(src, 'models', 'extra', 'index.ts')), true);
  assert.equal(existsSync(join(src, 'models', 'extra', 'extra.ts')), true);
  assert.match(
    readFileSync(join(src, 'models', 'index.ts'), 'utf8'),
    /^export \* from '\.\/extra\/index\.ts';$/m,
  );
  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});

void test('a user index.ts that metadata.json does not declare is removed on regeneration with its module', async () => {
  // Arrange
  await using directory = await workspaceDirectory('cleanup-undeclared-index-');
  const src = join(directory.path, 'src');
  await generate(withOperations, settingsFor(directory.path));
  addUserBarrel(src);

  // Act
  await generate(withOperations, settingsFor(directory.path));

  // Assert
  assert.equal(existsSync(join(src, 'models', 'extra', 'index.ts')), false);
  assert.equal(existsSync(join(src, 'models', 'extra', 'extra.ts')), false);
  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});

void test('regenerating a spec without operations removes the inputs folder an earlier run wrote, index included', async () => {
  // Arrange
  await using directory = await workspaceDirectory('cleanup-stale-inputs-');
  const src = join(directory.path, 'src');
  await generate(withOperations, settingsFor(directory.path));
  assert.equal(existsSync(join(src, 'inputs', 'index.ts')), true);

  // Act
  await generate(withoutOperations, settingsFor(directory.path));

  // Assert
  assert.equal(existsSync(join(src, 'inputs', 'index.ts')), false);
  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});

void test('generating over the pagination folder that sdk-it 0.46.11 wrote removes it, index included', async () => {
  // Arrange
  await using directory = await workspaceDirectory('cleanup-old-pagination-');
  const src = join(directory.path, 'src');
  await generate(withOperations, settingsFor(directory.path));
  // The files 0.46.11 wrote; no operation of this version writes a
  // pagination folder.
  mkdirSync(join(src, 'pagination'));
  writeFileSync(
    join(src, 'pagination', 'cursor-pagination.ts'),
    'export class CursorPagination {}\n',
  );
  writeFileSync(
    join(src, 'pagination', 'index.ts'),
    "export * from './cursor-pagination.ts';\n",
  );

  // Act
  await generate(withOperations, settingsFor(directory.path));

  // Assert
  assert.equal(existsSync(join(src, 'pagination', 'index.ts')), false);
  assert.equal(
    existsSync(join(src, 'pagination', 'cursor-pagination.ts')),
    false,
  );
  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});
