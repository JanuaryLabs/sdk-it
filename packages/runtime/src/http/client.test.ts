import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { z } from 'zod';

import {
  Dispatcher,
  Ok,
  type Route,
  createClient,
  empty,
  toRequest,
} from '@sdk-it/runtime';
import { typecheck, workspaceDirectory } from '@sdk-it/testing';

/** `GET /pets`, shaped the way a generated SDK's endpoint table is. */
const listPets = {
  schema: z.object({}),
  output: [Ok],
  security: [],
  toRequest(input: Record<string, never>, baseUrl: string) {
    return toRequest(
      'GET',
      '/pets',
      empty(input, {
        contentType: 'application/json',
        inputHeaders: [],
        inputQuery: [],
        inputBody: [],
        inputParams: [],
      }),
      baseUrl,
    );
  },
  dispatch(input: Record<string, never>, options) {
    const dispatcher = new Dispatcher(options.interceptors, options.fetch);
    return dispatcher.send(
      this.toRequest(input, options.baseUrl),
      this.output,
      options.signal,
    );
  },
} satisfies Route;

function api<const Servers extends readonly string[]>(servers: Servers) {
  return {
    routes: { 'GET /pets': listPets },
    servers,
    securitySchemes: {},
    credentials: z.object({}),
  };
}

describe('Client baseUrl', () => {
  test('a spec with one server sends to it when the settings name none', async () => {
    const client = createClient(api(['https://api.test/v1']), {});

    const { url } = await client.prepare('GET /pets', {});

    assert.equal(url.href, 'https://api.test/v1/pets');
  });

  test('a spec without servers sends to "/" (OpenAPI 3.2), which needs a page location to resolve', async () => {
    const client = createClient(api([]), {});

    await assert.rejects(client.prepare('GET /pets', {}), {
      message:
        'baseUrl "/" is relative, and there is no page location to resolve it against.',
    });
  });

  test('a spec with two servers requires a baseUrl', async () => {
    const servers = ['https://eu.api.test', 'https://us.api.test'] as const;
    // @ts-expect-error two servers leave no single default
    const client = createClient(api(servers), {});

    await assert.rejects(client.prepare('GET /pets', {}));
  });

  test('a baseUrl setting wins over the spec servers', async () => {
    const client = createClient(
      api(['https://eu.api.test', 'https://us.api.test']),
      { baseUrl: 'https://us.api.test' },
    );

    const { url } = await client.prepare('GET /pets', {});

    assert.equal(url.href, 'https://us.api.test/pets');
  });
});

test('the credentials setting exists only for a spec with security schemes', async () => {
  await using workspace = await workspaceDirectory('runtime-client-settings-');
  await writeFile(
    join(workspace.path, 'consumer.ts'),
    `import { z } from 'zod';
import { createClient, stringCredentialSchema, type Route } from '@sdk-it/runtime';

declare const route: Route;
const open = { routes: { 'GET /pets': route }, servers: ['https://api.test'], securitySchemes: {}, credentials: z.object({}) } as const;
const secured = {
  routes: { 'GET /pets': route },
  servers: ['https://api.test'],
  securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
  credentials: z.object({ apiKey: stringCredentialSchema.optional() }),
} as const;

createClient(secured, { credentials: { apiKey: 'secret' } });
// @ts-expect-error a spec without security schemes takes no credentials, not even an empty set
createClient(open, { credentials: {} });
// @ts-expect-error credentials name the spec's security schemes
createClient(secured, { credentials: { other: 'secret' } });
`,
  );

  const { files, diagnostics } = typecheck({
    tsconfig: {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
      },
      include: ['consumer.ts'],
    },
    directory: workspace.path,
  });

  assert.ok(files.some((file) => file.endsWith('consumer.ts')));
  assert.deepStrictEqual(diagnostics, []);
});
