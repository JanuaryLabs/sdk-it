import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { rpc } from '@sdk-it/rpc';
import { parseErrorFor } from '@sdk-it/testing';

// OAS 3.0 documents sometimes write `required: true` on a schema; JSON Schema
// only knows `required` as an array of property names on the parent object.
const spec = {
  openapi: '3.1.0',
  info: { title: 'Profiles', version: '1.0.0' },
  servers: [{ url: 'https://api.test' }],
  paths: {
    '/profiles': {
      post: {
        operationId: 'createProfile',
        tags: ['profiles'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: true,
                properties: {
                  name: { type: 'string', required: true },
                  bio: { type: 'string', required: false },
                },
              },
            },
          },
        },
        responses: { '204': { description: 'Created' } },
      },
    },
    '/profiles/{id}/avatar': {
      put: {
        operationId: 'putAvatar',
        tags: ['profiles'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'image/jpeg': {
              schema: { type: 'string', format: 'byte', required: true },
            },
          },
        },
        responses: { '204': { description: 'Stored' } },
      },
    },
  },
} as unknown as OpenAPIObject;

test('rpc builds a client for a schema whose required is a boolean: a required property is required, the others keep their own', async () => {
  await using directory = await new TemporaryFiles().directory(
    'rpc-boolean-required-',
  );
  const specPath = join(directory.path, 'openapi.json');
  await writeFile(specPath, JSON.stringify(spec));
  const sent: Request[] = [];
  const client = await rpc(specPath, {
    fetch: async (request: Request) => {
      sent.push(request);
      return new Response(null, { status: 204 });
    },
  });

  await assert.rejects(
    client.request('POST /profiles', { bio: 'x' }),
    parseErrorFor('name'),
  );
  await client.request('POST /profiles', { name: 'Ada' });
  await client.request('PUT /profiles/{id}/avatar', {
    id: 'p1',
    $body: new Blob(['jpg']),
  });

  assert.equal(sent.length, 2);
  assert.equal(await sent[0].text(), '{"name":"Ada"}');
  assert.equal(sent[1].url, 'https://api.test/profiles/p1/avatar');
  assert.equal(sent[1].headers.get('content-type'), 'image/jpeg');
  assert.equal(await sent[1].text(), 'jpg');
});
