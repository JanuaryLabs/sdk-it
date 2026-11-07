import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { workspaceDirectory } from '@sdk-it/testing';
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
    generate(spec, {
      output: output.path,
      name: '2024 api',
      packageName: '@acme/sdk',
    }),
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
    generate(spec, {
      output: join(output.path, 'sdk'),
      name: 'Default',
      packageName: '@acme/sdk',
    }),
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

const clashes = [
  { name: 'Servers', identifier: 'servers' },
  { name: 'Request', identifier: 'request' },
  { name: 'Prepare', identifier: 'prepare' },
  { name: 'ParseInput', identifier: 'parseInput' },
  { name: 'Z', identifier: 'z' },
];

void test('generate, render and renderModule refuse a client name whose default instance is a name the SDK already declares or exports, naming that name', async () => {
  for (const { name, identifier } of clashes) {
    await using output = await new TemporaryFiles().directory(
      'sdk-it-client-name-',
    );
    const refusal = {
      name: 'TypeError',
      message: new RegExp(`"${name}".*\\b${identifier}\\b`),
    };

    await assert.rejects(
      generate(spec, {
        output: output.path,
        name,
        packageName: '@acme/sdk',
      }),
      refusal,
    );
    await assert.rejects(
      render(spec, {
        name,
        style: { name: 'github' },
        useTsExtension: true,
      }),
      refusal,
    );
    await assert.rejects(renderModule(spec, { name }), refusal);
    assert.deepEqual(await readdir(output.path), []);
  }
});

void test('a client name close to an SDK name gives a module that loads and builds requests with its default instance', async () => {
  const { text } = await renderModule(spec, { name: 'Requests' });
  await using workspace = await workspaceDirectory('client-name-near-');
  await writeFile(join(workspace.path, 'requests.ts'), text);
  const { requests } = await import(
    pathToFileURL(join(workspace.path, 'requests.ts')).href
  );

  const { url } = await requests.prepare('GET /items', {});

  assert.equal(url.href, 'https://names.test/items');
});
