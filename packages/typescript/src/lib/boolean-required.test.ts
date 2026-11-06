import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadSpec } from '@sdk-it/spec';
import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

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
};

test('a schema whose required is a boolean generates a client: a required property is required, the others keep their own', async () => {
  await using workspace = await workspaceDirectory('boolean-required-');
  try {
    const specPath = join(workspace.path, 'openapi.json');
    await writeFile(specPath, JSON.stringify(spec));
    await generate((await loadSpec(specPath)).spec, {
      output: workspace.path,
      name: 'Profiles',
      readme: false,
      mode: 'full',
    });
    await writeFile(
      join(workspace.path, 'src/consumer.ts'),
      `import { createProfiles } from './index.ts';
const client = createProfiles({ baseUrl: 'https://api.test' });
void client.request('POST /profiles', { name: 'Ada' });
// @ts-expect-error name was marked required on the property.
void client.request('POST /profiles', { bio: 'x' });
void client.request('PUT /profiles/{id}/avatar', { id: 'p1', $body: new Blob(['jpg']) });
`,
    );
    const consumer = join(workspace.path, 'src/consumer.ts');
    const { files, diagnostics } = typecheck(
      join(workspace.path, 'tsconfig.json'),
    );
    const bundle = join(workspace.path, 'client.mjs');
    await build({
      entryPoints: [join(workspace.path, 'src/index.ts')],
      outfile: bundle,
      bundle: true,
      packages: 'external',
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });
    const { createProfiles } = await import(pathToFileURL(bundle).href);
    const sent: Request[] = [];
    const client = createProfiles({
      baseUrl: 'https://api.test',
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

    assert.ok(files.includes(consumer));
    assert.deepEqual(diagnostics, []);
    assert.equal(sent.length, 2);
    assert.equal(await sent[0].text(), '{"name":"Ada"}');
    assert.equal(sent[1].url, 'https://api.test/profiles/p1/avatar');
    assert.equal(sent[1].headers.get('content-type'), 'image/jpeg');
    assert.equal(await sent[1].text(), 'jpg');
  } finally {
    await stop();
  }
});
