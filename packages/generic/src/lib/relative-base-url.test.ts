import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
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
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-relative-base-url-')),
  );
  try {
    const require = createRequire(import.meta.url);
    const modules = dirname(dirname(require.resolve('zod/package.json')));
    await symlink(modules, join(dir, 'node_modules'), 'dir');
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
        },
        include: ['route.ts'],
      }),
    );
    await writeFile(join(dir, 'route.ts'), routes);

    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths, components } = await analyze(project, { responseAnalyzer });
    const output = join(dir, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
        paths,
        components,
      },
      { output, name: 'Items', readme: false, mode: 'full' },
    );
    const bundle = join(dir, 'client.js');
    await build({
      entryPoints: [join(output, 'src/index.ts')],
      outfile: bundle,
      bundle: true,
      format: 'iife',
      globalName: 'sdk',
      platform: 'browser',
      nodePaths: [modules],
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
      `new sdk.Items({ baseUrl: '/api', fetch: (request) => fetch(request) })
        .request('GET /items', {})`,
      realm,
    );

    assert.deepEqual(urls, ['https://app.example.com/api/items']);
  } finally {
    stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a relative baseUrl without location rejects the request with a TypeError naming baseUrl', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-relative-base-url-node-')),
  );
  try {
    const require = createRequire(import.meta.url);
    await symlink(
      dirname(dirname(require.resolve('zod/package.json'))),
      join(dir, 'node_modules'),
      'dir',
    );
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
        },
        include: ['route.ts'],
      }),
    );
    await writeFile(join(dir, 'route.ts'), routes);

    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths, components } = await analyze(project, { responseAnalyzer });
    const output = join(dir, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
        paths,
        components,
      },
      { output, name: 'Items', readme: false, mode: 'full' },
    );
    const { Items } = await import(
      pathToFileURL(join(output, 'src/index.ts')).href
    );
    assert.equal('location' in globalThis, false);
    const fetch = async () => Response.json({ items: ['a'] });

    const client = new Items({ baseUrl: '/api', fetch });

    await assert.rejects(client.request('GET /items', {}), {
      name: 'TypeError',
      message: /baseUrl/,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
