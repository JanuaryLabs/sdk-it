import { build as esbuild } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { workspaceDirectory } from '@sdk-it/testing';

import backend from './client.ts';
import type { Spec } from './sdk.ts';

// The http layer every generated SDK embeds is @sdk-it/runtime's source.
const runtimeHttpDir = join(
  dirname(fileURLToPath(import.meta.resolve('@sdk-it/runtime/package.json'))),
  'src',
  'http',
);
const runtimeHttpFiles = await Promise.all(
  [
    'client.ts',
    'dispatcher.ts',
    'interceptors.ts',
    'parse-response.ts',
    'parser.ts',
    'request.ts',
    'response.ts',
    'security.ts',
    'sse.ts',
  ].map(
    async (file) =>
      [file, await readFile(join(runtimeHttpDir, file), 'utf-8')] as const,
  ),
);

interface BuiltClient {
  module: any;
  fetchCalls: Request[];
  fetchShim: (req: Request) => Promise<Response>;
}

interface BuildOptions {
  spec: Omit<Spec, 'operations' | 'securitySchemes'> &
    Partial<Pick<Spec, 'securitySchemes'>>;
  respond?: (req: Request) => Response | Promise<Response>;
  extraSchema?: string;
  /** Output type tuple expression for the operations, e.g. `[NoContent]`. Defaults to `[Ok<unknown>]`. */
  output?: string;
}

// Identical inputs produce identical bundles, so cache compiled modules
// instead of re-running esbuild for every test that shares a spec.
const compiledSdks = new Map<string, Promise<any>>();

function compileSdk(options: BuildOptions): Promise<any> {
  const key = JSON.stringify({
    spec: options.spec,
    makeImport: options.spec.makeImport?.toString(),
    extraSchema: options.extraSchema,
    output: options.output,
  });
  let compiled = compiledSdks.get(key);
  if (!compiled) {
    compiled = bundleSdk(options);
    compiledSdks.set(key, compiled);
  }
  return compiled;
}

async function bundleSdk(options: BuildOptions): Promise<any> {
  await using directory = await workspaceDirectory('client-runtime-');
  const clientSrc = backend({ securitySchemes: {}, ...options.spec });

  const httpDir = join(directory.path, 'http');
  const apiDir = join(directory.path, 'api');
  await mkdir(httpDir, { recursive: true });
  await mkdir(apiDir, { recursive: true });

  for (const [file, source] of runtimeHttpFiles) {
    await writeFile(join(httpDir, file), source);
  }

  const operationSchema =
    options.extraSchema ??
    `z.object({ limit: z.number().optional(), 'x-trace-id': z.string().optional() })`;

  await writeFile(
    join(apiDir, 'schemas.ts'),
    `import { z } from 'zod';
import { toRequest, json, empty } from '../http/request';
import { Dispatcher, fetchType } from '../http/dispatcher';
import { Ok, NoContent } from '../http/response';
import type { Interceptor } from '../http/interceptors';

const listUsersSchema = ${operationSchema};
const operationOutput = ${options.output ?? '[Ok<unknown>]'};

export default {
  'GET /users': {
    schema: listUsersSchema,
    output: operationOutput,
    security: [],
    toRequest(input: z.input<typeof listUsersSchema>, baseUrl: string) {
      return toRequest('GET', '/users', empty(input as any, {
        contentType: 'application/empty',
        inputHeaders: ['x-trace-id'],
        inputQuery: ['limit'],
        inputBody: [],
        inputParams: [],
      }), baseUrl);
    },
    async dispatch(
      input: z.input<typeof listUsersSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
        baseUrl: string;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(this.toRequest(input, options.baseUrl), this.output, options?.signal);
    },
  },
  'POST /users': {
    schema: listUsersSchema,
    output: operationOutput,
    security: [],
    toRequest(input: z.input<typeof listUsersSchema>, baseUrl: string) {
      return toRequest('POST', '/users', json(input as any, {
        contentType: 'application/json',
        inputHeaders: [],
        inputQuery: [],
        inputBody: ['limit'],
        inputParams: [],
      }), baseUrl);
    },
    async dispatch(
      input: z.input<typeof listUsersSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
        baseUrl: string;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(this.toRequest(input, options.baseUrl), this.output, options?.signal);
    },
  },
};
`,
  );

  const clientPath = join(directory.path, 'client.ts');
  await writeFile(clientPath, clientSrc);

  const entryPath = join(directory.path, 'entry.ts');
  await writeFile(
    entryPath,
    `export * from './client';\nexport * from './http/response';\nexport { default as schemas } from './api/schemas';\n`,
  );

  const outFile = join(directory.path, 'bundle.mjs');
  await esbuild({
    entryPoints: [entryPath],
    bundle: true,
    outfile: outFile,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });

  return await import(pathToFileURL(outFile).href);
}

async function buildSdk(options: BuildOptions): Promise<BuiltClient> {
  const module = await compileSdk(options);
  const fetchCalls: Request[] = [];
  const respond =
    options.respond ??
    ((_req: Request) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
  const fetchShim = async (req: Request) => {
    fetchCalls.push(req);
    return respond(req);
  };
  return { module, fetchCalls, fetchShim };
}

describe('emitted client runtime', () => {
  test('basic client: GET request is dispatched to fetch with method, url, and default Accept header', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
    });

    const client = module.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const data = await client.request('GET /users', { limit: 5 });

    assert.strictEqual(fetchCalls.length, 1);
    const req = fetchCalls[0];
    assert.strictEqual(req.method, 'GET');
    assert.strictEqual(req.url, 'https://api.example.com/users?limit=5');
    assert.deepStrictEqual(data, { ok: true });
  });

  test('with one server: omitting baseUrl uses the declared server', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiClient',
        servers: ['https://api.example.com'],
        makeImport: (p) => p,
      },
    });

    const client = module.createApiClient({ fetch: fetchShim });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].url, 'https://api.example.com/users');
  });

  test('with multiple servers: omitting baseUrl requires an explicit choice', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiClient',
        servers: ['https://api.example.com', 'https://staging.example.com'],
        makeImport: (p) => p,
      },
    });

    const client = module.createApiClient({ fetch: fetchShim });

    await assert.rejects(client.request('GET /users', {}), /baseUrl/);
    assert.strictEqual(fetchCalls.length, 0);
  });

  test('with-servers client: explicit baseUrl overrides the default server', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiClient',
        servers: ['https://api.example.com', 'https://staging.example.com'],
        makeImport: (p) => p,
      },
    });

    const client = module.createApiClient({
      fetch: fetchShim,
      baseUrl: 'https://staging.example.com',
    });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].url, 'https://staging.example.com/users');
  });

  test('with server variables: expanded URLs remain available for explicit selection', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiClient',
        servers: [
          'https://production.api.example.com/v1',
          'https://production.api.example.com/v2',
          'https://staging.api.example.com/v1',
          'https://staging.api.example.com/v2',
        ],
        makeImport: (p) => p,
      },
    });

    const client = module.createApiClient({
      baseUrl: 'https://production.api.example.com/v1',
      fetch: fetchShim,
    });
    await client.request('GET /users', {});

    assert.strictEqual(
      fetchCalls[0].url,
      'https://production.api.example.com/v1/users',
    );

    assert.deepStrictEqual(module.servers, [
      'https://production.api.example.com/v1',
      'https://production.api.example.com/v2',
      'https://staging.api.example.com/v1',
      'https://staging.api.example.com/v2',
    ]);
  });

  test('headers option: default headers from options.headers are sent', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
    });

    const client = module.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      headers: { 'x-custom': 'hello' },
    });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].headers.get('x-custom'), 'hello');
  });

  test('per-request headers override default headers from options', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
    });

    const client = module.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      headers: { 'x-custom': 'default' },
    });

    await client.request(
      'GET /users',
      {},
      { headers: { 'x-custom': 'per-request' } },
    );

    assert.strictEqual(fetchCalls[0].headers.get('x-custom'), 'per-request');
  });

  test('POST /users sends JSON body and content-type header', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
    });

    const client = module.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    await client.request('POST /users', { limit: 7 });

    const req = fetchCalls[0];
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.headers.get('Content-Type'), 'application/json');
    const body = await req.json();
    assert.deepStrictEqual(body, { limit: 7 });
  });

  test('prepare returns url+init without firing fetch', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
    });

    const client = module.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const prepared = await client.prepare('GET /users', { limit: 9 });

    assert.strictEqual(fetchCalls.length, 0);
    assert.strictEqual(prepared.init.method, 'GET');
    assert.strictEqual(
      String(prepared.url),
      'https://api.example.com/users?limit=9',
    );
    assert.strictEqual(typeof prepared.parse, 'function');
  });

  test('baseUrl accepts function returning string', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
    });

    const client = module.createTestClient({
      baseUrl: () => 'https://dynamic.example.com',
      fetch: fetchShim,
    });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].url, 'https://dynamic.example.com/users');
  });

  test('baseUrl accepts async function returning string', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
    });

    const client = module.createTestClient({
      baseUrl: async () => 'https://async.example.com',
      fetch: fetchShim,
    });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].url, 'https://async.example.com/users');
  });

  test('skipValidation bypasses zod schema enforcement on input', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        makeImport: (p) => p,
      },
      extraSchema: `z.object({ limit: z.number() })`,
    });

    const client = module.createTestClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      skipValidation: true,
    });

    await client.request('GET /users', { limit: 'not-a-number' });

    assert.strictEqual(fetchCalls.length, 1);
  });
});

describe('emitted client runtime: 204 No Content responses', () => {
  test('204 without a Content-Type header (the spec-correct case) resolves to null data', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 204 }),
    });

    const client = module.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const data = await client.request('GET /users', {});

    assert.strictEqual(data, null);
  });

  test('204 with a Content-Type header resolves to null data (body short-circuited)', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        makeImport: (p) => p,
      },
      respond: () =>
        new Response(null, {
          status: 204,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const client = module.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const data = await client.request('GET /users', {});

    assert.strictEqual(data, null);
  });

  test('205 Reset Content without a Content-Type header resolves to null data', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 205 }),
    });

    const client = module.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const data = await client.request('GET /users', {});

    assert.strictEqual(data, null);
  });

  test('a body-bearing status (200) with no Content-Type still throws — the guard only relaxes for no-body statuses', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 200 }),
    });

    const client = module.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    await assert.rejects(
      () => client.request('GET /users', {}),
      /Content-Type header is missing/,
    );
  });

  test('304 Not Modified (no Content-Type) surfaces as an APIError with status 304 and null data, not a parser throw', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 304 }),
    });

    const client = module.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    await assert.rejects(
      () => client.request('GET /users', {}),
      (error: unknown) => {
        assert.ok(error instanceof module.APIError);
        assert.ok(
          error instanceof Error && 'status' in error && 'data' in error,
        );
        assert.strictEqual(error.status, 304);
        assert.strictEqual(error.data, null);
        return true;
      },
    );
  });

  test('operation declaring NoContent output: request resolves to null and parse yields a NoContent instance', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        makeImport: (p) => p,
      },
      output: '[NoContent]',
      respond: () => new Response(null, { status: 204 }),
    });

    const client = module.createNoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const data = await client.request('GET /users', {});
    assert.strictEqual(data, null);

    const prepared = await client.prepare('GET /users', {});
    const response = await prepared.parse(new Response(null, { status: 204 }));

    assert.ok(response instanceof module.NoContent);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.data, null);
  });
});
