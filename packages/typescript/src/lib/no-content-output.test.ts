import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Account', version: '1.0.0' },
  paths: {
    '/me/password': {
      post: {
        operationId: 'changePassword',
        tags: ['me'],
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
};

void test('a 204 response is typed null, not never, in the Endpoints map and the request result', async () => {
  await using workspace = await workspaceDirectory('no-content-types-');
  await generate(spec, {
    output: workspace.path,
    name: 'Account',
    readme: false,
    mode: 'full',
  });
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `
import { createAccount, type AccountEndpoints } from './index.ts';
type Output = AccountEndpoints['POST /me/password']['output'];
type IsNever<T> = [T] extends [never] ? true : false;
const notNever: IsNever<Output> = false;
const nothing: Output = null;
// @ts-expect-error A response without content carries no data.
const something: Output = {};
const client = createAccount({ baseUrl: 'https://example.test' });
const change = () => client.request('POST /me/password', {});
type Result = Awaited<ReturnType<typeof change>>;
const resultNotNever: IsNever<Result> = false;
const resultNothing: Result = null;
// @ts-expect-error The request result carries no data either.
const resultSomething: Result = {};
void [
  notNever,
  nothing,
  something,
  resultNotNever,
  resultNothing,
  resultSomething,
];
`,
  );
  const config = JSON.parse(
    await readFile(join(workspace.path, 'tsconfig.json'), 'utf8'),
  );
  config.compilerOptions.strict = true;

  const { files, diagnostics } = typecheck({
    tsconfig: config,
    directory: workspace.path,
  });

  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});

void test('a 204 response resolves to null at runtime', async () => {
  await using workspace = await workspaceDirectory('no-content-runtime-');
  try {
    await generate(spec, {
      output: workspace.path,
      name: 'Account',
      readme: false,
      mode: 'full',
    });
    const bundle = join(workspace.path, 'client.mjs');
    await build({
      entryPoints: [join(workspace.path, 'src/index.ts')],
      outfile: bundle,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });
    const { createAccount } = await import(pathToFileURL(bundle).href);
    const client = createAccount({
      baseUrl: 'https://api.example.com',
      fetch: async () => new Response(null, { status: 204 }),
    });

    assert.equal(await client.request('POST /me/password', {}), null);
  } finally {
    await stop();
  }
});
