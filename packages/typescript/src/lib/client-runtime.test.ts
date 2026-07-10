import { build as esbuild } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import backend from './client.ts';
import type { Spec } from './sdk.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const httpTemplatesDir = join(__dirname, 'http');
const repoRoot = join(__dirname, '..', '..', '..', '..');

const [
  dispatcherTxt,
  interceptorsTxt,
  parseResponseTxt,
  parserTxt,
  requestTxt,
  responseTxt,
  sseTxt,
] = await Promise.all(
  [
    'dispatcher.txt',
    'interceptors.txt',
    'parse-response.txt',
    'parser.txt',
    'request.txt',
    'response.txt',
    'sse.txt',
  ].map((file) => readFile(join(httpTemplatesDir, file), 'utf-8')),
);

interface BuiltClient {
  module: any;
  fetchCalls: Request[];
  fetchShim: (req: Request) => Promise<Response>;
}

interface BuildOptions {
  spec: Omit<Spec, 'operations'>;
  respond?: (req: Request) => Response | Promise<Response>;
  extraSchema?: string;
  /** Output type tuple expression for the operations, e.g. `[NoContent]`. Defaults to `[Ok<unknown>]`. */
  output?: string;
}

// Identical inputs produce identical bundles, so cache compiled modules
// instead of re-running esbuild for every test that shares a spec. The tmp
// dir is removed as soon as the bundle is imported — no teardown needed.
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
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-client-runtime-'));
  try {
    const clientSrc = backend(options.spec);

    const httpDir = join(dir, 'http');
    const apiDir = join(dir, 'api');
    await mkdir(httpDir, { recursive: true });
    await mkdir(apiDir, { recursive: true });

    await writeFile(
      join(httpDir, 'dispatcher.ts'),
      `import z from 'zod';
import { type Interceptor } from './interceptors';
import { type RequestConfig } from './request';
import { buffered } from './parse-response';
import { type SSEListener } from './sse';
import { APIError, APIResponse, type SuccessfulResponse, type RebindSuccessPayload } from './response';

${dispatcherTxt}`,
    );
    await writeFile(
      join(httpDir, 'interceptors.ts'),
      `import type { RequestConfig, HeadersInit } from './request';\n${interceptorsTxt}`,
    );
    await writeFile(join(httpDir, 'parse-response.ts'), parseResponseTxt);
    await writeFile(join(httpDir, 'parser.ts'), parserTxt);
    await writeFile(join(httpDir, 'request.ts'), requestTxt);
    await writeFile(join(httpDir, 'response.ts'), responseTxt);
    await writeFile(join(httpDir, 'sse.ts'), sseTxt);

    const operationSchema =
      options.extraSchema ??
      `z.object({ limit: z.number().optional(), 'x-trace-id': z.string().optional() })`;

    await writeFile(
      join(apiDir, 'schemas.ts'),
      `import z from 'zod';
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
    toRequest(input: z.input<typeof listUsersSchema>) {
      return toRequest('GET /users', empty(input as any, {
        inputHeaders: ['x-trace-id'],
        inputQuery: ['limit'],
        inputBody: [],
        inputParams: [],
      }));
    },
    async dispatch(
      input: z.input<typeof listUsersSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(this.toRequest(input), this.output, options?.signal);
    },
  },
  'POST /users': {
    schema: listUsersSchema,
    output: operationOutput,
    toRequest(input: z.input<typeof listUsersSchema>) {
      return toRequest('POST /users', json(input as any, {
        inputHeaders: [],
        inputQuery: [],
        inputBody: ['limit'],
        inputParams: [],
      }));
    },
    async dispatch(
      input: z.input<typeof listUsersSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(this.toRequest(input), this.output, options?.signal);
    },
  },
};
`,
    );

    await writeFile(
      join(apiDir, 'endpoints.ts'),
      `import type z from 'zod';
import type schemas from './schemas';
import type { APIResponse, SuccessfulResponse } from '../http/response';
import type { Unionize } from '../http/dispatcher';

type DispatchReturn<E extends keyof typeof schemas> = Awaited<
  ReturnType<(typeof schemas)[E]['dispatch']>
>;
export type InferData<E extends keyof typeof schemas> =
  DispatchReturn<E> extends APIResponse<infer D> ? D : DispatchReturn<E>;
`,
    );

    const clientPath = join(dir, 'client.ts');
    await writeFile(clientPath, clientSrc);

    const entryPath = join(dir, 'entry.ts');
    await writeFile(
      entryPath,
      `export * from './client';\nexport * from './http/response';\nexport { default as schemas } from './api/schemas';\n`,
    );

    const outFile = join(dir, 'bundle.mjs');
    await esbuild({
      entryPoints: [entryPath],
      bundle: true,
      outfile: outFile,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      absWorkingDir: dir,
      nodePaths: [join(repoRoot, 'node_modules')],
      logLevel: 'silent',
    });

    return await import(pathToFileURL(outFile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.TestClient({
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

  test('with-token client: string token is wrapped as Bearer Authorization header', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'AuthClient',
        servers: [],
        options: [
          {
            name: 'Authorization',
            in: 'header',
            'x-optionName': 'token',
            schema: { type: 'string' },
            required: false,
          },
        ],
        makeImport: (p) => p,
      },
    });

    const client = new module.AuthClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      token: 'abc123',
    });

    await client.request('GET /users', {});

    const req = fetchCalls[0];
    assert.strictEqual(req.headers.get('Authorization'), 'Bearer abc123');
  });

  test('with-token client: function token is resolved (sync) and sent as Bearer header', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'AuthClient',
        servers: [],
        options: [
          {
            name: 'Authorization',
            in: 'header',
            'x-optionName': 'token',
            schema: { type: 'string' },
            required: false,
          },
        ],
        makeImport: (p) => p,
      },
    });

    const client = new module.AuthClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      token: () => 'fn-token',
    });

    await client.request('GET /users', {});

    assert.strictEqual(
      fetchCalls[0].headers.get('Authorization'),
      'Bearer fn-token',
    );
  });

  test('with-token client: async-function token is awaited and sent as Bearer header', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'AuthClient',
        servers: [],
        options: [
          {
            name: 'Authorization',
            in: 'header',
            'x-optionName': 'token',
            schema: { type: 'string' },
            required: false,
          },
        ],
        makeImport: (p) => p,
      },
    });

    const client = new module.AuthClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      token: async () => 'async-token',
    });

    await client.request('GET /users', {});

    assert.strictEqual(
      fetchCalls[0].headers.get('Authorization'),
      'Bearer async-token',
    );
  });

  test('with-api-key client: x-api-key header from options is sent on every request', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiKeyClient',
        servers: [],
        options: [
          {
            name: 'x-api-key',
            in: 'header',
            schema: { type: 'string' },
            required: true,
          },
        ],
        makeImport: (p) => p,
      },
    });

    const client = new module.ApiKeyClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      'x-api-key': 'secret-key',
    });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].headers.get('x-api-key'), 'secret-key');
  });

  test('with-servers client: omitting baseUrl falls back to the first declared server', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiClient',
        servers: ['https://api.example.com', 'https://staging.example.com'],
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.ApiClient({ fetch: fetchShim });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].url, 'https://api.example.com/users');
  });

  test('with-servers client: explicit baseUrl overrides the default server', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiClient',
        servers: ['https://api.example.com', 'https://staging.example.com'],
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.ApiClient({
      fetch: fetchShim,
      baseUrl: 'https://staging.example.com',
    });

    await client.request('GET /users', {});

    assert.strictEqual(fetchCalls[0].url, 'https://staging.example.com/users');
  });

  test('with-server-variables client: expanded enum URLs become the default server list', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'ApiClient',
        servers: [
          'https://production.api.example.com/v1',
          'https://production.api.example.com/v2',
          'https://staging.api.example.com/v1',
          'https://staging.api.example.com/v2',
        ],
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.ApiClient({ fetch: fetchShim });
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

  test('input option: organizationId in options is merged into request input', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'InputClient',
        servers: [],
        options: [
          {
            name: 'organizationId',
            in: 'input',
            schema: { type: 'string' },
            required: false,
          },
        ],
        makeImport: (p) => p,
      },
      extraSchema: `z.object({ organizationId: z.string().optional(), limit: z.number().optional() })`,
    });

    const client = new module.InputClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      organizationId: 'org-42',
    });

    const inputs = await client.defaultInputs();
    assert.deepStrictEqual(inputs, { organizationId: 'org-42' });
  });

  test('with-multiple-options client: token and api-key are both attached as headers', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'FullClient',
        servers: ['https://api.example.com'],
        options: [
          {
            name: 'Authorization',
            in: 'header',
            'x-optionName': 'token',
            schema: { type: 'string' },
            required: false,
          },
          {
            name: 'x-api-key',
            in: 'header',
            schema: { type: 'string' },
            required: true,
          },
        ],
        makeImport: (p) => p,
      },
    });

    const client = new module.FullClient({
      fetch: fetchShim,
      token: 'tok',
      'x-api-key': 'key',
    });

    await client.request('GET /users', {});

    const req = fetchCalls[0];
    assert.strictEqual(req.headers.get('Authorization'), 'Bearer tok');
    assert.strictEqual(req.headers.get('x-api-key'), 'key');
    assert.strictEqual(req.url, 'https://api.example.com/users');
  });

  test('headers option: default headers from options.headers are sent', async () => {
    const { module, fetchCalls, fetchShim } = await buildSdk({
      spec: {
        name: 'TestClient',
        servers: [],
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.TestClient({
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
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.TestClient({
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
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.TestClient({
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
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.TestClient({
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
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.TestClient({
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
        options: [],
        makeImport: (p) => p,
      },
    });

    const client = new module.TestClient({
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
        options: [],
        makeImport: (p) => p,
      },
      extraSchema: `z.object({ limit: z.number() })`,
    });

    const client = new module.TestClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
      skipValidation: true,
    });

    await client.request('GET /users', { limit: 'not-a-number' as any });

    assert.strictEqual(fetchCalls.length, 1);
  });
});

describe('emitted client runtime: attachment responses', () => {
  test('attachment with a JSON content type resolves to a Blob', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'AttachmentClient',
        servers: [],
        options: [],
        makeImport: (p) => p,
      },
      output: '[Ok<Blob>]',
      respond: () =>
        new Response(JSON.stringify({ name: 'Ada' }), {
          status: 200,
          headers: {
            'Content-Disposition': 'attachment; filename="profile.json"',
            'Content-Type': 'application/json',
          },
        }),
    });

    const client = new module.AttachmentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const data = await client.request('GET /users', {});

    assert.ok(data instanceof Blob, 'attachment responses must remain binary');
    assert.strictEqual(await data.text(), '{"name":"Ada"}');
  });

  test('inline JSON continues to use content-type parsing', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'InlineClient',
        servers: [],
        options: [],
        makeImport: (p) => p,
      },
      output: '[Ok<{ name: string }>]',
      respond: () =>
        new Response(JSON.stringify({ name: 'Ada' }), {
          status: 200,
          headers: {
            'Content-Disposition': 'inline; filename="profile.json"',
            'Content-Type': 'application/json',
          },
        }),
    });

    const client = new module.InlineClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    const data = await client.request('GET /users', {});

    assert.deepStrictEqual(data, { name: 'Ada' });
  });
});

describe('emitted client runtime: 204 No Content responses', () => {
  test('204 without a Content-Type header (the spec-correct case) resolves to null data', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        options: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 204 }),
    });

    const client = new module.NoContentClient({
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
        options: [],
        makeImport: (p) => p,
      },
      respond: () =>
        new Response(null, {
          status: 204,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const client = new module.NoContentClient({
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
        options: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 205 }),
    });

    const client = new module.NoContentClient({
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
        options: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 200 }),
    });

    const client = new module.NoContentClient({
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
        options: [],
        makeImport: (p) => p,
      },
      respond: () => new Response(null, { status: 304 }),
    });

    const client = new module.NoContentClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchShim,
    });

    await assert.rejects(
      () => client.request('GET /users', {}),
      (error: unknown) => {
        assert.ok(error instanceof module.APIError);
        assert.strictEqual((error as { status: number }).status, 304);
        assert.strictEqual((error as { data: unknown }).data, null);
        return true;
      },
    );
  });

  test('operation declaring NoContent output: request resolves to null and parse yields a NoContent instance', async () => {
    const { module, fetchShim } = await buildSdk({
      spec: {
        name: 'NoContentClient',
        servers: [],
        options: [],
        makeImport: (p) => p,
      },
      output: '[NoContent]',
      respond: () => new Response(null, { status: 204 }),
    });

    const client = new module.NoContentClient({
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
