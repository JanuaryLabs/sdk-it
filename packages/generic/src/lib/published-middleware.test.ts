import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
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
import ts from 'typescript';

import { getProgram } from '@sdk-it/core';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

test('published middleware preserves source error responses through client generation', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-published-middleware-')),
  );
  try {
    const require = createRequire(import.meta.url);
    const packageRoot = dirname(require.resolve('@sdk-it/hono/package.json'));
    const modules = dirname(dirname(require.resolve('zod/package.json')));
    const installed = join(dir, 'node_modules/@sdk-it/hono');
    const [packed] = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          packageRoot,
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          dir,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, npm_config_cache: join(dir, 'npm-cache') },
        },
      ),
    );
    // Materialize precisely npm's tarball file list, without a second packlist or archive parser.
    for (const { path } of packed.files as { path: string }[]) {
      await mkdir(dirname(join(installed, path)), { recursive: true });
      await cp(join(packageRoot, path), join(installed, path));
    }
    for (const name of ['hono', 'zod', 'fast-content-type-parse', '@types']) {
      await symlink(
        join(modules, name),
        join(dir, 'node_modules', name),
        'dir',
      );
    }
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(
      join(dir, 'route.ts'),
      `import { Hono } from 'hono';
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
    );
    assert.equal(
      createRequire(join(dir, 'route.ts')).resolve('@sdk-it/hono/runtime'),
      join(installed, 'dist/lib/runtime/index.js'),
    );
    const { app } = (await import(
      pathToFileURL(join(dir, 'route.ts')).href
    )) as { app: Hono };
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
      const payload = (await response.json()) as {
        cause: { code: string; detail: string };
      };
      if (code) {
        assert.equal(payload.cause.code, code);
        assert.equal(typeof payload.cause.detail, 'string');
        assert.ok(!('details' in payload.cause));
      } else {
        assert.deepEqual(payload, { name: 'Ada' });
      }
    }
    const configPath = join(dir, 'tsconfig.json');
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
      return analyze(configPath, { responseAnalyzer });
    };
    const source = await analyzeRoute({
      '@sdk-it/hono/runtime': [join(packageRoot, 'src/lib/runtime/index.ts')],
    });
    const published = await analyzeRoute({});
    assert.deepEqual(
      getProgram(configPath).getCompilerOptions().customConditions,
      ['@sdk-it/source', 'consumer-condition'],
    );
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
      assert.deepEqual(await analyze(configPath, { responseAnalyzer }), source);
    }

    // Ordinary consumers still compile against declarations, and execute built JS.
    const parsed = ts.parseJsonConfigFileContent(
      JSON.parse(await readFile(configPath, 'utf8')),
      ts.sys,
      dir,
    );
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    assert.ok(
      program.getSourceFile(join(installed, 'dist/lib/runtime/validator.d.ts')),
    );
    assert.equal(
      program.getSourceFile(join(installed, 'src/lib/runtime/validator.ts')),
      undefined,
    );
    assert.deepEqual(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      [],
    );

    const output = join(dir, 'client');
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
        readme: false,
        mode: 'full',
      },
    );
    const { Items, BadRequest, UnsupportedMediaType } = await import(
      pathToFileURL(join(output, 'src/index.ts')).href
    );
    for (const [contentType, body, ErrorClass] of [
      ['application/json', '{', BadRequest],
      ['text/plain', 'Ada', UnsupportedMediaType],
    ] as const) {
      const client = new Items({
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
      `import type { Endpoints } from './index.ts';
type ErrorResponse = Extract<Endpoints['POST /items']['error'], { status: number }>;
const statuses: ErrorResponse['status'][] = [400, 415];
function describe(error: ErrorResponse): string {
  return error.data.cause.detail;
}
void [statuses, describe];
`,
    );
    const clientConfig = ts.readConfigFile(
      join(output, 'tsconfig.json'),
      ts.sys.readFile,
    );
    assert.equal(clientConfig.error, undefined);
    const clientParsed = ts.parseJsonConfigFileContent(
      clientConfig.config,
      ts.sys,
      output,
      { strict: true },
    );
    assert.deepEqual(clientParsed.errors, []);
    const clientProgram = ts.createProgram(
      clientParsed.fileNames,
      clientParsed.options,
    );
    assert.deepEqual(
      ts
        .getPreEmitDiagnostics(clientProgram)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
