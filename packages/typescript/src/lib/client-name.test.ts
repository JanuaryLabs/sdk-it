import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { clientName, generate, render, renderModule } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Names', version: '1.0.0' },
  servers: [{ url: 'https://names.test' }],
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        tags: ['items'],
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
};

void test('generate refuses a client name that does not give a TypeScript identifier, naming the value, and writes nothing', async () => {
  await using output = await new TemporaryFiles().directory(
    'sdk-it-client-name-',
  );

  await assert.rejects(
    generate(spec, { output: output.path, name: '2024 api' }),
    { name: 'TypeError', message: /"2024 api"/ },
  );

  assert.deepEqual(await readdir(output.path), []);
});

void test('render and renderModule refuse a client name that does not give a TypeScript identifier, naming the value', async () => {
  await assert.rejects(
    render(spec, {
      name: '2024 api',
      style: { name: 'github' },
      useTsExtension: true,
    }),
    { name: 'TypeError', message: /"2024 api"/ },
  );
  await assert.rejects(renderModule(spec, { name: 'Books (v2)' }), {
    name: 'TypeError',
    message: /"Books \(v2\)"/,
  });
});

void test('generate refuses a client name whose default instance is a reserved word, naming the value', async () => {
  await using output = await new TemporaryFiles().directory(
    'sdk-it-client-name-',
  );

  await assert.rejects(
    generate(spec, { output: join(output.path, 'sdk'), name: 'Default' }),
    { name: 'TypeError', message: /"Default".*\bdefault\b/ },
  );
});

void test('clientName gives the name generate builds the exports from', () => {
  assert.equal(clientName('books api'), 'BooksApi');
  assert.equal(clientName('Café'), 'Café');
  assert.throws(() => clientName('2024-api'), {
    name: 'TypeError',
    message: /"2024-api"/,
  });
});
