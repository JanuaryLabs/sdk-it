import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadSpec } from '@sdk-it/spec';

/** Loads a Postman collection whose one request, GET /pets, saved `response`, and returns that response's content. */
async function savedPetResponse(response: {
  header?: { key: string; value: string }[];
  body?: string;
}) {
  await using dir = await new TemporaryFiles().directory('postman-response-');
  const collection = join(dir.path, 'collection.json');
  await writeFile(
    collection,
    JSON.stringify({
      info: {
        name: 'Pets',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Get pets',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.test/pets',
              host: ['api', 'test'],
              path: ['pets'],
            },
          },
          response: [{ name: 'Pets', code: 200, ...response }],
        },
      ],
    }),
  );
  const { spec } = await loadSpec(collection);
  return spec.paths?.['/pets']?.get?.responses?.['200'].content;
}

test('a saved response whose Content-Type is not a media type stops the collection from loading', async () => {
  await assert.rejects(
    savedPetResponse({
      header: [{ key: 'Content-Type', value: 'json' }],
      body: '[{"name":"Rex"}]',
    }),
    { name: 'TypeError', message: /"json"/ },
  );
});

const pets = {
  type: 'array',
  items: { type: 'object', properties: { name: { type: 'string' } } },
};

test('a saved response is keyed by its media type, lowercased and without parameters, and carries the schema of its body', async () => {
  const content = await savedPetResponse({
    header: [{ key: 'Content-Type', value: 'Application/JSON; charset=utf-8' }],
    body: '[{"name":"Rex"}]',
  });

  assert.deepStrictEqual(content, { 'application/json': { schema: pets } });
});

test('a saved response with a body and no Content-Type header is keyed application/json', async () => {
  const content = await savedPetResponse({ body: '[{"name":"Rex"}]' });

  assert.deepStrictEqual(content, { 'application/json': { schema: pets } });
});

test('a saved response whose Content-Type header is empty is keyed application/json', async () => {
  const content = await savedPetResponse({
    header: [{ key: 'Content-Type', value: '' }],
    body: '[{"name":"Rex"}]',
  });

  assert.deepStrictEqual(content, { 'application/json': { schema: pets } });
});

test('a saved response whose Content-Type has a parameter without a value, such as application/json; charset, is keyed application/json', async () => {
  const content = await savedPetResponse({
    header: [{ key: 'Content-Type', value: 'application/json; charset' }],
    body: '[{"name":"Rex"}]',
  });

  assert.deepStrictEqual(content, { 'application/json': { schema: pets } });
});

test('a saved response without a body is keyed application/octet-stream and has no schema', async () => {
  const content = await savedPetResponse({});

  assert.deepStrictEqual(content, {
    'application/octet-stream': { schema: undefined },
  });
});
