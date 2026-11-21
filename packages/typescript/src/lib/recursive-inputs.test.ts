import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Shortcuts', version: '1.0.0' },
  servers: [{ url: 'https://api.test' }],
  components: {
    schemas: {
      JsonValue: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { type: 'array', items: { $ref: '#/components/schemas/JsonValue' } },
          {
            type: 'object',
            additionalProperties: { $ref: '#/components/schemas/JsonValue' },
          },
        ],
      },
      Tree: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          children: { $ref: '#/components/schemas/Forest' },
        },
        required: ['label'],
      },
      Forest: { type: 'array', items: { $ref: '#/components/schemas/Tree' } },
    },
  },
  paths: {
    '/shortcuts': {
      post: {
        operationId: 'saveShortcut',
        tags: ['shortcuts'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  integrations: {
                    type: 'object',
                    additionalProperties: {
                      $ref: '#/components/schemas/JsonValue',
                    },
                  },
                  tree: { $ref: '#/components/schemas/Tree' },
                },
                required: ['integrations', 'tree'],
              },
            },
          },
        },
        responses: { '204': { description: 'Saved' } },
      },
    },
  },
};

test('a generated client validates and sends recursive inputs, a self-referencing one and two that reference each other', async () => {
  await using workspace = await workspaceDirectory('recursive-inputs-');
  await generate(spec, {
    output: workspace.path,
    name: 'Shortcuts',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
  });
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));
  const { createShortcuts } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const sent: Request[] = [];
  const client = createShortcuts({
    baseUrl: 'https://api.test',
    fetch: async (request: Request) => {
      sent.push(request);
      return new Response(null, { status: 204 });
    },
  });
  const input = {
    integrations: { slack: { channels: ['a', 'b'], muted: null } },
    tree: { label: 'root', children: [{ label: 'leaf', children: [] }] },
  };

  await client.request('POST /shortcuts', input);
  await assert.rejects(
    client.request('POST /shortcuts', {
      integrations: { slack: { depth: { n: 1n } } },
      tree: { label: 'root' },
    }),
    parseErrorFor('integrations'),
  );
  await assert.rejects(
    client.request('POST /shortcuts', {
      integrations: {},
      tree: { label: 'root', children: [{ children: [] }] },
    }),
    parseErrorFor('tree'),
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(sent.length, 1);
  assert.deepEqual(await sent[0].json(), input);
});

test('a recursive input may omit a required readOnly property at every depth and must send a required writeOnly one', async () => {
  await using workspace = await workspaceDirectory('recursive-read-only-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Folders', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      components: {
        schemas: {
          Folder: {
            type: 'object',
            properties: {
              id: { type: 'string', readOnly: true },
              secret: { type: 'string', writeOnly: true },
              name: { type: 'string' },
              children: { $ref: '#/components/schemas/Folders' },
            },
            required: ['id', 'secret', 'name'],
          },
          Folders: {
            type: 'array',
            items: { $ref: '#/components/schemas/Folder' },
          },
        },
      },
      paths: {
        '/folders': {
          post: {
            operationId: 'saveFolder',
            tags: ['folders'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Folder' },
                },
              },
            },
            responses: { '204': { description: 'Saved' } },
          },
        },
      },
    },
    {
      output: workspace.path,
      name: 'Folders',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  await writeFile(
    join(workspace.path, 'src', 'consumer.ts'),
    `import { folders } from './index.ts';
await folders.request('POST /folders', {
  name: 'root',
  secret: 's',
  children: [{ name: 'leaf', secret: 't' }],
});
await folders.request('POST /folders', {
  name: 'root',
  secret: 's',
  // @ts-expect-error a child's secret stays required
  children: [{ name: 'leaf' }],
});
`,
  );
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));
  const { createFolders } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const bodies: unknown[] = [];
  const client = createFolders({
    fetch: async (request: Request) => {
      bodies.push(await request.json());
      return new Response(null, { status: 204 });
    },
  });
  const input = {
    name: 'root',
    secret: 's',
    children: [{ name: 'leaf', secret: 't' }],
  };

  await client.request('POST /folders', input);
  await assert.rejects(
    client.request('POST /folders', {
      name: 'root',
      secret: 's',
      children: [{ name: 'leaf' }],
    }),
    parseErrorFor('children'),
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(bodies, [input]);
});
