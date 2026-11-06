import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// Content-Disposition tells a user agent to offer the response as a file
// (RFC 6266 §4.2). Content-Type decides how the body is read (RFC 9110 §8.3).
const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Downloads', version: '1.0.0' },
  paths: {
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

/** Generates the SDK into `directory` and loads its bundle. */
async function generateClient(directory: string, response: Response) {
  await generate(spec, {
    output: directory,
    name: 'Downloads',
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
  const { Downloads } = await import(pathToFileURL(bundle).href);
  return new Downloads({
    baseUrl: 'https://api.test',
    fetch: async () => response,
  });
}

void test('a JSON attachment resolves to the parsed JSON its type declares', async () => {
  await using workspace = await workspaceDirectory('attachment-json-');
  try {
    const client = await generateClient(
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
      `import { Downloads } from './index.ts';
const client = new Downloads({ baseUrl: 'https://api.test' });
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
    const client = await generateClient(
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
    const client = await generateClient(
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
