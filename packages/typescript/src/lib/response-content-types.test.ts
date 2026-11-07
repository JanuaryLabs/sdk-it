import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// Content-Type decides how the body is read (RFC 9110 §8.3); a media type
// with the +json suffix is JSON (RFC 6839 §3.1). Content-Disposition only
// tells a user agent to offer the response as a file (RFC 6266 §4.2).
const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Store', version: '1.0.0' },
  components: {
    schemas: {
      Status: { type: 'object', properties: { ok: { type: 'boolean' } } },
    },
  },
  paths: {
    '/orders/latest': {
      get: {
        operationId: 'latestOrder',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'The latest order',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '404': {
            description: 'No order yet',
            content: {
              'application/problem+json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    status: { type: 'integer' },
                    detail: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/repos/current': {
      get: {
        operationId: 'currentRepo',
        tags: ['repos'],
        responses: {
          '200': {
            description: 'The current repository',
            content: {
              'application/vnd.github.v3+json': {
                schema: {
                  type: 'object',
                  properties: { full_name: { type: 'string' } },
                  required: ['full_name'],
                },
              },
            },
          },
        },
      },
    },
    '/profile': {
      get: {
        operationId: 'downloadProfile',
        tags: ['downloads'],
        responses: {
          '200': {
            description: 'The profile as a JSON file',
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
        },
      },
    },
    '/health': {
      get: {
        operationId: 'health',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'The service health as one word',
            content: {
              'text/plain': {
                schema: { type: 'string', enum: ['ok', 'degraded'] },
              },
            },
          },
        },
      },
    },
    '/legacy-ref': {
      get: {
        operationId: 'legacyRefStatus',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'A text/json status whose schema is a shared object',
            content: {
              'text/json': { schema: { $ref: '#/components/schemas/Status' } },
            },
          },
        },
      },
    },
    '/legacy': {
      get: {
        operationId: 'legacyStatus',
        tags: ['orders'],
        responses: {
          '200': {
            description: 'A status under the unregistered text/json media type',
            content: {
              'text/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    },
    '/report': {
      get: {
        operationId: 'downloadReport',
        tags: ['downloads'],
        responses: {
          '200': {
            description: 'The report',
            content: { 'application/pdf': {} },
          },
        },
      },
    },
    '/export': {
      get: {
        operationId: 'downloadExport',
        tags: ['downloads'],
        responses: {
          '200': {
            description: 'The export archive',
            headers: {
              'Content-Disposition': { schema: { type: 'string' } },
            },
            content: { 'application/octet-stream': {} },
          },
        },
      },
    },
  },
};

/** Generates the SDK into `directory`, imports it, and builds a client whose fetch answers `response`. */
async function generateClient(directory: string, response: Response) {
  await generate(spec, {
    output: directory,
    name: 'Store',
    readme: false,
    mode: 'full',
  });
  const sdk: {
    createStore: (settings: unknown) => {
      request(endpoint: string, input: unknown): Promise<unknown>;
    };
    NotFound: new (...args: never[]) => Error & { data: unknown };
  } = await import(pathToFileURL(join(directory, 'src/index.ts')).href);
  const client = sdk.createStore({
    baseUrl: 'https://api.test',
    fetch: async () => response,
  });
  return { sdk, client };
}

void test('a problem+json error rejects with the declared error carrying the problem details', async () => {
  await using workspace = await workspaceDirectory('json-problem-');
  const problem = { title: 'Not Found', status: 404, detail: 'No order yet' };
  const { sdk, client } = await generateClient(
    workspace.path,
    new Response(JSON.stringify(problem), {
      status: 404,
      headers: { 'Content-Type': 'Application/Problem+JSON; charset=utf-8' },
    }),
  );

  await assert.rejects(client.request('GET /orders/latest', {}), (error) => {
    assert.ok(error instanceof sdk.NotFound);
    assert.deepEqual(error.data, problem);
    return true;
  });
});

void test('a vendor +json response resolves to the parsed JSON', async () => {
  await using workspace = await workspaceDirectory('json-vendor-');
  const { client } = await generateClient(
    workspace.path,
    new Response(JSON.stringify({ full_name: 'octo/hello' }), {
      headers: {
        'Content-Type': 'application/vnd.github.v3+json; charset=utf-8',
      },
    }),
  );

  const repo = await client.request('GET /repos/current', {});

  assert.deepEqual(repo, { full_name: 'octo/hello' });
});

void test('a JSON attachment resolves to the parsed JSON its type declares', async () => {
  await using workspace = await workspaceDirectory('attachment-json-');
  const { client } = await generateClient(
    workspace.path,
    new Response(JSON.stringify({ name: 'Ada' }), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="profile.json"',
      },
    }),
  );
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `import { createStore } from './index.ts';
const client = createStore({ baseUrl: 'https://api.test' });
export async function nameOf(): Promise<string> {
  const profile = await client.request('GET /profile', {});
  return profile.name;
}
`,
  );

  const profile = await client.request('GET /profile', {});
  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  assert.deepEqual(profile, { name: 'Ada' });
  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});

void test('a PDF download is read as a Blob by its Content-Type', async () => {
  await using workspace = await workspaceDirectory('attachment-pdf-');
  const { client } = await generateClient(
    workspace.path,
    new Response('%PDF-1.7', {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="report.pdf"',
      },
    }),
  );

  const report = await client.request('GET /report', {});

  assert.ok(report instanceof Blob);
  assert.equal(await report.text(), '%PDF-1.7');
});

void test('an octet-stream download is read as a Blob by its Content-Type', async () => {
  await using workspace = await workspaceDirectory('attachment-octet-');
  const { client } = await generateClient(
    workspace.path,
    new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="export.bin"',
      },
    }),
  );

  const archive = await client.request('GET /export', {});

  assert.ok(archive instanceof Blob);
  assert.deepEqual([...(await archive.bytes())], [1, 2, 3]);
});

void test('a text/json response is text, as its text/* type says, because only application/json and +json types are JSON (RFC 6839)', async () => {
  await using workspace = await workspaceDirectory('text-json-');
  const { client } = await generateClient(
    workspace.path,
    new Response('{"ok":true}', { headers: { 'Content-Type': 'text/json' } }),
  );
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `import { createStore } from './index.ts';
const client = createStore({ baseUrl: 'https://api.test' });
export async function status(): Promise<string> {
  return client.request('GET /legacy', {});
}
`,
  );

  const status = await client.request('GET /legacy', {});
  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  assert.equal(status, '{"ok":true}');
  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});

void test('a text body keeps a schema that describes a string, and reads any other schema as a string', async () => {
  await using workspace = await workspaceDirectory('text-schema-');
  await generateClient(workspace.path, new Response(null));
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `import { createStore } from './index.ts';
const client = createStore({ baseUrl: 'https://api.test' });
export async function health(): Promise<'ok' | 'degraded'> {
  return client.request('GET /health', {});
}
export async function sharedStatus(): Promise<string> {
  return client.request('GET /legacy-ref', {});
}
`,
  );

  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});
