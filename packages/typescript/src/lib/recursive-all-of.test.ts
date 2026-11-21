import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('a component that refers to itself through an allOf in a property is a recursive type the client types and validates at every depth', async () => {
  await using workspace = await workspaceDirectory('recursive-all-of-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Trees', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: {
                type: 'array',
                items: { allOf: [{ $ref: '#/components/schemas/Node' }] },
              },
            },
            required: ['name'],
          },
        },
      },
      paths: {
        '/nodes': {
          post: {
            operationId: 'saveNode',
            tags: ['nodes'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Node' },
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
      name: 'Trees',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  await writeFile(
    join(workspace.path, 'src', 'consumer.ts'),
    `import { trees } from './index.ts';
await trees.request('POST /nodes', {
  name: 'root',
  children: [{ name: 'branch', children: [{ name: 'leaf' }] }],
});
await trees.request('POST /nodes', {
  name: 'root',
  // @ts-expect-error a grandchild's name stays a string
  children: [{ name: 'branch', children: [{ name: 1 }] }],
});
`,
  );
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));
  const { createTrees } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const bodies: unknown[] = [];
  const client = createTrees({
    fetch: async (request: Request) => {
      bodies.push(await request.json());
      return new Response(null, { status: 204 });
    },
  });
  const input = {
    name: 'root',
    children: [{ name: 'branch', children: [{ name: 'leaf' }] }],
  };

  await client.request('POST /nodes', input);
  await assert.rejects(
    client.request('POST /nodes', {
      name: 'root',
      children: [{ name: 'branch', children: [{ children: [] }] }],
    }),
    parseErrorFor('children'),
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(bodies, [input]);
});
