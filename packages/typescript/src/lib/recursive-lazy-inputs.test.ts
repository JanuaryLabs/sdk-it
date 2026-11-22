import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('a component that is a union of itself is typed by its request side: a request may omit its required readOnly property at every depth', async () => {
  await using workspace = await workspaceDirectory('recursive-union-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Formulas', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      components: {
        schemas: {
          Expr: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  id: { type: 'string', readOnly: true },
                  value: { type: 'number' },
                },
                required: ['id', 'value'],
              },
              { type: 'array', items: { $ref: '#/components/schemas/Expr' } },
            ],
          },
        },
      },
      paths: {
        '/formulas': {
          post: {
            operationId: 'saveFormula',
            tags: ['formulas'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      expr: { $ref: '#/components/schemas/Expr' },
                    },
                    required: ['expr'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Saved',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Expr' },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      output: workspace.path,
      name: 'Formulas',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  await writeFile(
    join(workspace.path, 'src', 'consumer.ts'),
    `import { formulas } from './index.ts';
await formulas.request('POST /formulas', {
  expr: [{ value: 1 }, [{ value: 2 }]],
});
await formulas.request('POST /formulas', {
  // @ts-expect-error a nested value stays a number
  expr: [[{ value: 'two' }]],
});
`,
  );
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));
  const { createFormulas } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const bodies: unknown[] = [];
  const client = createFormulas({
    fetch: async (request: Request) => {
      bodies.push(await request.json());
      return Response.json({ id: 'f1', value: 1 });
    },
  });
  const input = { expr: [{ value: 1 }, [{ value: 2 }]] };

  await client.request('POST /formulas', input);
  await assert.rejects(
    client.request('POST /formulas', { expr: [[{ value: 'two' }]] }),
    parseErrorFor('expr'),
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(bodies, [input]);
});

test('a component that is a record of itself is typed by its request side: a request may omit its required readOnly property at every depth', async () => {
  await using workspace = await workspaceDirectory('recursive-record-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Settings', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      components: {
        schemas: {
          Section: {
            type: 'object',
            additionalProperties: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    id: { type: 'string', readOnly: true },
                    value: { type: 'string' },
                  },
                  required: ['id', 'value'],
                },
                { $ref: '#/components/schemas/Section' },
              ],
            },
          },
        },
      },
      paths: {
        '/settings': {
          post: {
            operationId: 'saveSettings',
            tags: ['settings'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      root: { $ref: '#/components/schemas/Section' },
                    },
                    required: ['root'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Saved',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Section' },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      output: workspace.path,
      name: 'Settings',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  await writeFile(
    join(workspace.path, 'src', 'consumer.ts'),
    `import { settings } from './index.ts';
await settings.request('POST /settings', {
  root: { theme: { value: 'dark' }, editor: { font: { value: 'mono' } } },
});
await settings.request('POST /settings', {
  // @ts-expect-error a nested value stays a string
  root: { editor: { font: { value: 12 } } },
});
`,
  );
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));
  const { createSettings } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const bodies: unknown[] = [];
  const client = createSettings({
    fetch: async (request: Request) => {
      bodies.push(await request.json());
      return Response.json({});
    },
  });
  const input = {
    root: { theme: { value: 'dark' }, editor: { font: { value: 'mono' } } },
  };

  await client.request('POST /settings', input);
  await assert.rejects(
    client.request('POST /settings', {
      root: { editor: { font: { value: 12 } } },
    }),
    parseErrorFor('root'),
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(bodies, [input]);
});

test('a component that is an array of objects holding itself is typed by its request side: a request may omit its required readOnly property at every depth', async () => {
  await using workspace = await workspaceDirectory('recursive-array-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Outlines', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      components: {
        schemas: {
          Node: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', readOnly: true },
                title: { type: 'string' },
                children: { $ref: '#/components/schemas/Node' },
              },
              required: ['id', 'title', 'children'],
            },
          },
        },
      },
      paths: {
        '/outlines': {
          post: {
            operationId: 'saveOutline',
            tags: ['outlines'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      nodes: { $ref: '#/components/schemas/Node' },
                    },
                    required: ['nodes'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Saved',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Node' },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      output: workspace.path,
      name: 'Outlines',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  await writeFile(
    join(workspace.path, 'src', 'consumer.ts'),
    `import { outlines } from './index.ts';
await outlines.request('POST /outlines', {
  nodes: [{ title: 'root', children: [{ title: 'leaf', children: [] }] }],
});
await outlines.request('POST /outlines', {
  // @ts-expect-error a nested title stays a string
  nodes: [{ title: 'root', children: [{ title: 1, children: [] }] }],
});
`,
  );
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));
  const { createOutlines } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const bodies: unknown[] = [];
  const client = createOutlines({
    fetch: async (request: Request) => {
      bodies.push(await request.json());
      return Response.json([]);
    },
  });
  const input = {
    nodes: [{ title: 'root', children: [{ title: 'leaf', children: [] }] }],
  };

  await client.request('POST /outlines', input);
  await assert.rejects(
    client.request('POST /outlines', {
      nodes: [{ title: 'root', children: [{ title: 1, children: [] }] }],
    }),
    parseErrorFor('nodes'),
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(bodies, [input]);
});
