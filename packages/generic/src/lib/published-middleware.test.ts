import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire, findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('published middleware preserves source error responses through client generation', async () => {
  await using dir = await analysisWorkspace('published-middleware-', {
    'route.ts': `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ message: error.message, cause: error.cause }, error.status);
  throw error;
});
/** @openapi createItem */
app.post('/items', validate('application/json', (payload) => ({
  name: { select: payload.body.name, against: z.string() },
})), (c) => { return c.json({ name: c.var.input.name }); });
`,
  });
  const manifest = findPackageJSON('@sdk-it/hono', import.meta.url);
  assert.ok(manifest, '@sdk-it/hono resolves from this test');
  const packageRoot = dirname(manifest);
  const installed = join(dir.path, 'node_modules/@sdk-it/hono');
  // npm pack prints only the tarball's file name on stdout; its --json shape differs between npm 11 and 12.
  const tarball = execFileSync(
    'npm',
    ['pack', packageRoot, '--ignore-scripts', '--pack-destination', dir.path],
    {
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(dir.path, 'npm-cache') },
    },
  ).trim();
  // Install the published bytes: the tarball's single `package/` root becomes the package folder.
  await mkdir(installed, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    join(dir.path, tarball),
    '-C',
    installed,
    '--strip-components=1',
  ]);
  assert.equal(
    createRequire(join(dir.path, 'route.ts')).resolve('@sdk-it/hono/runtime'),
    join(installed, 'dist/lib/runtime/index.js'),
  );
  const { app }: { app: Hono } = await import(
    pathToFileURL(join(dir.path, 'route.ts')).href
  );
  for (const [contentType, body, status, code] of [
    ['application/json', '{"name":"Ada"}', 200, undefined],
    ['application/json', '{', 400, 'api/invalid-json'],
    ['application/json', 'null', 400, 'api/invalid-body'],
    ['application/json', '{"name":1}', 400, 'api/validation-failed'],
    ['text/plain', 'Ada', 415, 'api/unsupported-media-type'],
    ['', '', 415, 'api/unsupported-media-type'],
  ] as const) {
    const response = await app.request('/items', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    assert.equal(response.status, status);
    const payload: {
      cause: { code: string; detail: string };
    } = await response.json();
    if (code) {
      assert.equal(payload.cause.code, code);
      assert.equal(typeof payload.cause.detail, 'string');
      assert.ok(!('details' in payload.cause));
    } else {
      assert.deepEqual(payload, { name: 'Ada' });
    }
  }
  const configPath = dir.tsconfig;
  const compilerOptions = {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    customConditions: ['consumer-condition'],
  };
  const analyzeRoute = async (paths: Record<string, string[]>) => {
    await writeFile(
      configPath,
      JSON.stringify({
        compilerOptions: { ...compilerOptions, paths },
        include: ['route.ts'],
      }),
    );
    using project = openAnalysisProject(configPath);
    return await analyze(project, { responseAnalyzer });
  };
  const source = await analyzeRoute({
    '@sdk-it/hono/runtime': [join(packageRoot, 'src/lib/runtime/index.ts')],
  });
  const published = await analyzeRoute({});
  using project = openAnalysisProject(configPath);
  assert.deepEqual(project.program.getCompilerOptions().customConditions, [
    '@sdk-it/source',
    'consumer-condition',
  ]);
  const responses = published.paths['/items']?.post?.responses;
  assert.ok(responses);
  assert.deepEqual(Object.keys(responses), ['200', '400', '415']);
  assert.deepEqual(published, source);
  for (const module of ['Node16', 'NodeNext']) {
    await writeFile(
      configPath,
      JSON.stringify({
        compilerOptions: {
          ...compilerOptions,
          module,
          moduleResolution: module,
        },
        include: ['route.ts'],
      }),
    );
    using project = openAnalysisProject(configPath);
    assert.deepEqual(await analyze(project, { responseAnalyzer }), source);
  }

  // Ordinary consumers still compile against declarations, and execute built JS.
  const consumer = typecheck({
    tsconfig: JSON.parse(await readFile(configPath, 'utf8')),
    directory: dir.path,
  });
  assert.ok(
    consumer.files.includes(join(installed, 'dist/lib/runtime/validator.d.ts')),
  );
  assert.equal(
    consumer.files.includes(join(installed, 'src/lib/runtime/validator.ts')),
    false,
  );
  assert.deepEqual(consumer.diagnostics, []);

  const output = join(dir.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Items', version: '1.0.0' },
      paths: published.paths,
      components: published.components,
    },
    {
      output,
      name: 'Items',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  const { createItems, BadRequest, UnsupportedMediaType } = await import(
    pathToFileURL(join(output, 'src/index.ts')).href
  );
  for (const [contentType, body, ErrorClass] of [
    ['application/json', '{', BadRequest],
    ['text/plain', 'Ada', UnsupportedMediaType],
  ] as const) {
    const client = createItems({
      baseUrl: 'http://localhost',
      fetch: (request: Request) =>
        app.fetch(
          new Request(request, {
            headers: { 'content-type': contentType },
            body,
          }),
        ),
    });
    await assert.rejects(
      client.request('POST /items', { name: 'Ada' }),
      ErrorClass,
    );
  }
  await writeFile(
    join(output, 'src/consumer.ts'),
    `import type { ItemsEndpoints } from './index.ts';
type ErrorResponse = Extract<ItemsEndpoints['POST /items']['error'], { status: number }>;
const statuses: ErrorResponse['status'][] = [400, 415];
function describe(error: ErrorResponse): string {
  return error.data.cause.detail;
}
void [statuses, describe];
`,
  );
  const clientConfig = JSON.parse(
    await readFile(join(output, 'tsconfig.json'), 'utf8'),
  );
  assert.deepEqual(
    typecheck({
      tsconfig: {
        ...clientConfig,
        compilerOptions: { strict: true, ...clientConfig.compilerOptions },
      },
      directory: output,
    }).diagnostics,
    [],
  );
});
