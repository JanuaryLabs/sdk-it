import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
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

/** Generates the SDK into `directory`, loads its bundle, and builds a client whose fetch answers `response`. */
async function generateClient(directory: string, response: Response) {
  await generate(spec, {
    output: directory,
    name: 'Store',
    readme: false,
    mode: 'full',
  });
  const bundle = join(directory, 'client.mjs');
  await build({
    entryPoints: [join(directory, 'src/index.ts')],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const sdk: {
    Store: new (options: unknown) => {
      request(endpoint: string, input: unknown): Promise<unknown>;
    };
    NotFound: new (...args: never[]) => Error & { data: unknown };
  } = await import(pathToFileURL(bundle).href);
  const client = new sdk.Store({
    baseUrl: 'https://api.test',
    fetch: async () => response,
  });
  return { sdk, client };
}

void test('a problem+json error rejects with the declared error carrying the problem details', async () => {
  await using workspace = await workspaceDirectory('json-problem-');
  try {
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
  } finally {
    await stop();
  }
});

void test('a vendor +json response resolves to the parsed JSON', async () => {
  await using workspace = await workspaceDirectory('json-vendor-');
  try {
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
  } finally {
    await stop();
  }
});

void test('a JSON attachment resolves to the parsed JSON its type declares', async () => {
  await using workspace = await workspaceDirectory('attachment-json-');
  try {
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
      `import { Store } from './index.ts';
const client = new Store({ baseUrl: 'https://api.test' });
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
  } finally {
    await stop();
  }
});

void test('a PDF download is read as a Blob by its Content-Type', async () => {
  await using workspace = await workspaceDirectory('attachment-pdf-');
  try {
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
  } finally {
    await stop();
  }
});

void test('an octet-stream download is read as a Blob by its Content-Type', async () => {
  await using workspace = await workspaceDirectory('attachment-octet-');
  try {
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
  } finally {
    await stop();
  }
});
