import { waitFor } from '@zukhruf/testing/async';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createServer } from 'vite';

import { workspaceDirectory } from '@sdk-it/testing';
import sdkIt from '@sdk-it/vite';

// The test has its own file, so its process holds no other test's heap.
setFlagsFromString('--expose-gc');
const gc: () => void = runInNewContext('gc');

const heapMegabytes = () => {
  gc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
};

/** 700 paths and schemas render a module of about 2 MB; `round` names the server, so each write changes the module. */
function largeDocument(round: number) {
  const count = 700;
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Store', version: '1.0.0' },
    servers: [{ url: `https://store${round}.test` }],
    paths: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `/items${i}/{id}`,
        {
          get: {
            operationId: `getItem${i}`,
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'An item',
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/Item${i}` },
                  },
                },
              },
            },
          },
        },
      ]),
    ),
    components: {
      schemas: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `Item${i}`,
          {
            type: 'object',
            properties: {
              name: { type: 'string' },
              price: { type: 'number' },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        ]),
      ),
    },
  });
}

test(
  'a dev server serving a large imported document keeps a flat heap across reloads',
  { timeout: 120_000 },
  async (t) => {
    await using app = await workspaceDirectory('vite-heap-');
    const document = join(app.path, 'store.openapi');
    await writeFile(document, largeDocument(0));
    await writeFile(
      join(app.path, 'main.ts'),
      "export { servers } from './store.openapi';\n",
    );
    const created = await createServer({
      configFile: false,
      root: app.path,
      cacheDir: join(app.path, '.vite'),
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true, ws: false },
      plugins: [sdkIt.imports()],
    });
    await using server = Object.assign(created, {
      [Symbol.asyncDispose]: () => created.close(),
    });
    await server.ssrLoadModule('/main.ts');
    const reload = async (round: number) => {
      await writeFile(document, largeDocument(round));
      await waitFor(
        async () => {
          const { servers } = await server.ssrLoadModule('/main.ts');
          assert.deepEqual(servers, [`https://store${round}.test`]);
        },
        { signal: t.signal },
      );
    };
    await reload(1);
    const before = heapMegabytes();

    for (let round = 2; round <= 11; round++) await reload(round);
    const growth = heapMegabytes() - before;

    // Without the fix, each reload keeps the previous module: about 7 MB each.
    assert.ok(
      growth < 20,
      `heap grew ${Math.round(growth)} MB over 10 reloads`,
    );
  },
);
