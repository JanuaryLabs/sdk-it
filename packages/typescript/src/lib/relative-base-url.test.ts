import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Items', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        tags: ['items'],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
};

type CreateItems = (settings: unknown) => {
  request(endpoint: string, input: unknown): Promise<unknown>;
};

const loadClient = async (globals: Record<string, unknown>) => {
  await using workspace = await workspaceDirectory('relative-base-url-');
  try {
    await generate(spec, {
      output: workspace.path,
      name: 'Items',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    });
    const outfile = join(workspace.path, 'bundle.cjs');
    await build({
      entryPoints: [join(workspace.path, 'src/index.ts')],
      outfile,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const moduleShim: { exports: { createItems?: CreateItems } } = {
      exports: {},
    };
    const context = createContext({
      module: moduleShim,
      exports: moduleShim.exports,
      require: createRequire(import.meta.url),
      console,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      Request,
      Response,
      Headers,
      FormData,
      Blob,
      AbortController,
      AbortSignal,
      ...globals,
    });
    runInContext(await readFile(outfile, 'utf8'), context);
    const { createItems } = moduleShim.exports;
    assert.ok(createItems);
    return createItems;
  } finally {
    await stop();
  }
};

const recordingFetch = () => {
  const urls: string[] = [];
  const fetch = async (input: Request | URL | string) => {
    urls.push(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return Response.json({});
  };
  return { urls, fetch };
};

void test('a relative baseUrl resolves against the page location', async () => {
  const { urls, fetch } = recordingFetch();
  const createItems = await loadClient({
    fetch,
    location: new URL('https://app.example.com/dashboard'),
  });
  const client = createItems({ baseUrl: '/api', fetch });

  await client.request('GET /items', {});

  assert.deepEqual(urls, ['https://app.example.com/api/items']);
});

void test('a relative baseUrl without a page location rejects the request naming baseUrl', async () => {
  const { urls, fetch } = recordingFetch();
  const createItems = await loadClient({ fetch });
  const client = createItems({ baseUrl: '/api', fetch });

  await assert.rejects(client.request('GET /items', {}), {
    name: 'TypeError',
    message: /baseUrl/,
  });
  assert.deepEqual(urls, []);
});

void test('an absolute baseUrl works where URL rejects non-http bases as React Native does', async () => {
  const { urls, fetch } = recordingFetch();
  class ReactNativeURL extends URL {
    constructor(url: string | URL, base?: string | URL) {
      if (base !== undefined) {
        const { protocol } = new URL(String(base));
        if (!['http:', 'https:', 'ftp:'].includes(protocol)) {
          throw new TypeError(`Invalid base URL: ${String(base)}`);
        }
      }
      super(url, base);
    }
  }
  const createItems = await loadClient({ fetch, URL: ReactNativeURL });
  const client = createItems({ baseUrl: 'https://api.example.com', fetch });

  await client.request('GET /items', {});

  assert.deepEqual(urls, ['https://api.example.com/items']);
});
