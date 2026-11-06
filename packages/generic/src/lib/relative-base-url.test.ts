import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const routes = `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/**
 * @openapi listItems
 * @tags items
 */
app.get('/items', validate(() => ({})), (c) => {
  return c.json({ items: ['a'] });
});
`;

test('a relative baseUrl resolves against location in a browser-like realm', async () => {
  await using dir = await analysisWorkspace('relative-base-url-', {
    'route.ts': routes,
  });
  try {
    using project = openAnalysisProject(dir.tsconfig);
    const { paths, components } = await analyze(project, { responseAnalyzer });
    const output = join(dir.path, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
        paths,
        components,
      },
      { output, name: 'Items', readme: false, mode: 'full' },
    );
    const bundle = join(dir.path, 'client.js');
    await build({
      entryPoints: [join(output, 'src/index.ts')],
      outfile: bundle,
      bundle: true,
      format: 'iife',
      globalName: 'sdk',
      platform: 'browser',
      logLevel: 'silent',
    });
    const urls: string[] = [];
    const realm = createContext({
      location: new URL('https://app.example.com/dashboard'),
      fetch: async (request: Request) => {
        urls.push(request.url);
        return Response.json({ items: ['a'] });
      },
      URL,
      URLSearchParams,
      Request,
      Response,
      Headers,
      FormData,
      Blob,
      File,
      AbortController,
      AbortSignal,
      TextEncoder,
      TextDecoder,
      ReadableStream,
      TransformStream,
      WritableStream,
      TextDecoderStream,
      structuredClone,
      console,
      setTimeout,
      clearTimeout,
      queueMicrotask,
    });
    runInContext(await readFile(bundle, 'utf8'), realm);

    await runInContext(
      `sdk.createItems({ baseUrl: '/api', fetch: (request) => fetch(request) })
        .request('GET /items', {})`,
      realm,
    );

    assert.deepEqual(urls, ['https://app.example.com/api/items']);
  } finally {
    await stop();
  }
});

test('a relative baseUrl without location rejects the request with a TypeError naming baseUrl', async () => {
  await using dir = await analysisWorkspace('relative-base-url-node-', {
    'route.ts': routes,
  });

  using project = openAnalysisProject(dir.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  const output = join(dir.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Items', version: '1.0.0' },
      paths,
      components,
    },
    { output, name: 'Items', readme: false, mode: 'full' },
  );
  const { createItems } = await import(
    pathToFileURL(join(output, 'src/index.ts')).href
  );
  assert.equal('location' in globalThis, false);
  const fetch = async () => Response.json({ items: ['a'] });

  const client = createItems({ baseUrl: '/api', fetch });

  await assert.rejects(client.request('GET /items', {}), {
    name: 'TypeError',
    message: /baseUrl/,
  });
});
