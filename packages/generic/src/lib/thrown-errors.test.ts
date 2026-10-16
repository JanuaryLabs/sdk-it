import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

void test.each(
  [
    {
      name: 'reassigned let',
      setup: '',
      body: "let error: Error = new HTTPException(409); error = new Error('changed'); throw error;",
      status: 500,
      documented: false,
    },
    {
      name: 'reassigned var',
      setup: '',
      body: "var error: Error = new HTTPException(409); error = new Error('changed'); throw error;",
      status: 500,
      documented: false,
    },
    {
      name: 'alias of a mutable variable',
      setup: '',
      body: "let original: Error = new HTTPException(409); original = new Error('changed'); const error = original; throw error;",
      status: 500,
      documented: false,
    },
    {
      name: 'cyclic aliases',
      setup: '',
      body: 'const first: HTTPException = second; const second: HTTPException = first; throw first;',
      status: 500,
      documented: false,
    },
    {
      name: 'mutable namespace receiver',
      setup:
        "import * as original from './errors.ts'; let current: typeof original = original; current = { conflict: new HTTPException(418) };",
      body: 'throw current.conflict;',
      status: 418,
      documented: false,
    },
    {
      name: 'one constant in multiple operations',
      setup: 'const shared = new HTTPException(409);',
      body: 'throw shared;',
      status: 409,
      documented: true,
    },
    {
      name: 'existing function depth limit',
      setup: Array.from(
        { length: 7 },
        (_, index) =>
          `function deep${index}() { ${index === 6 ? 'const error = new HTTPException(409); throw error;' : `deep${index + 1}();`} }`,
      ).join('\n'),
      body: 'deep0();',
      status: 409,
      documented: false,
    },
  ],
  ({ name, setup, body, status, documented }) =>
    test(
      `throw analysis safely handles ${name}`,
      { timeout: 15_000 },
      async () => {
        await using workspace = await mkdtempDisposable(
          join(
            fileURLToPath(new URL('../../../../', import.meta.url)),
            '.throw-boundaries-',
          ),
        );
        await writeFile(
          join(workspace.path, 'package.json'),
          '{"type":"module"}',
        );
        await writeFile(
          join(workspace.path, 'tsconfig.json'),
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
        await writeFile(
          join(workspace.path, 'errors.ts'),
          "import { HTTPException } from 'hono/http-exception'; export const conflict = new HTTPException(409);",
        );
        await writeFile(
          join(workspace.path, 'route.ts'),
          `
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
${setup}
export const app = new Hono();
app.onError((error, c) => c.json({ message: error.message }, error instanceof HTTPException ? error.status : 500));
${['/first', '/second'].map((path) => `app.get('${path}', validate(() => ({})), (c) => { ${body} return c.json({ ok: true }); });`).join('\n')}
`,
        );
        const { app } = (await import(
          pathToFileURL(join(workspace.path, 'route.ts')).href
        )) as { app: Hono };
        for (const path of ['/first', '/second']) {
          assert.equal((await app.request(path)).status, status);
        }
        const spec = await analyze(join(workspace.path, 'tsconfig.json'), {
          responseAnalyzer,
        });
        for (const path of ['/first', '/second']) {
          assert.equal(
            Boolean(spec.paths[path].get?.responses?.['409']),
            documented,
          );
        }
      },
    ),
);

void test.each(['handler', 'middleware'] as const, (location) =>
  test.each(
    [
      'direct',
      'local',
      'alias',
      'long alias',
      'wrapped',
      'imported',
      'namespace',
      'helper',
      'runtime parse',
    ] as const,
    (form) =>
      test(`generated clients document and handle ${form} HTTP errors from a ${location}`, async () => {
        await using workspace = await mkdtempDisposable(
          join(
            fileURLToPath(new URL('../../../../', import.meta.url)),
            '.thrown-errors-',
          ),
        );
        try {
          const construction = `new HTTPException(409, {
        message: 'Item already exists',
        cause: { code: 'api/conflict' as const, itemId: 'item-1' },
      })`;
          const statement = {
            direct: `throw ${construction};`,
            local: `const error = ${construction}; throw error;`,
            alias: `const original = ${construction}; const alias = original; const error = alias; throw error;`,
            'long alias': `const original = ${construction}; ${Array.from({ length: 12 }, (_, index) => `const alias${index} = ${index === 0 ? 'original' : `alias${index - 1}`};`).join(' ')} throw alias11;`,
            wrapped: `const original = (${construction} satisfies HTTPException); const error = original as HTTPException; throw ((error as HTTPException)!);`,
            imported: 'throw importedConflict;',
            namespace: 'throw errors.conflict;',
            helper: 'rejectConflict();',
            'runtime parse':
              'await parse(z.object({ name: z.string() }), { name: 42 });',
          }[form];
          const status = form === 'runtime parse' ? 400 : 409;
          const reject = `if (c.req.query('conflict') === 'yes') { ${statement} }`;
          const mode = location === 'handler' ? 'full' : 'minimal';
          await writeFile(
            join(workspace.path, 'package.json'),
            '{"type":"module"}',
          );
          await writeFile(
            join(workspace.path, 'tsconfig.json'),
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
          await writeFile(
            join(workspace.path, 'errors.ts'),
            `import { HTTPException } from 'hono/http-exception'; export const conflict = ${construction};`,
          );
          await writeFile(
            join(workspace.path, 'route.ts'),
            `
import { Hono, type Context, type Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { validate, parse } from '@sdk-it/hono/runtime';
import { conflict as importedConflict } from './errors.ts';
import * as errors from './errors.ts';

function rejectConflict() { const error = ${construction}; throw error; }
function requireAvailable() {
  return async (c: Context, next: Next) => { ${reject} await next(); };
}

export const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ message: error.message, cause: error.cause }, error.status);
  throw error;
});
/** @openapi getItem */
app.get('/items', validate((payload) => ({
  conflict: { select: payload.query.conflict, against: z.string().optional() },
})), ${location === 'middleware' ? 'requireAvailable(),' : ''} async (c) => {
  ${location === 'handler' ? reject : ''}
  return c.json({ id: 'item-1' });
});
`,
          );
          const { app } = (await import(
            pathToFileURL(join(workspace.path, 'route.ts')).href
          )) as { app: Hono };
          const response = await app.request('/items?conflict=yes');
          assert.equal(response.status, status);
          const payload = await response.json();
          if (form === 'runtime parse') {
            assert.partialDeepStrictEqual(payload, {
              message: 'Validation failed',
              cause: {
                code: 'api/validation-failed',
                formErrors: [],
                errors: { name: [{ code: 'invalid_type', path: 'name' }] },
              },
            });
          } else
            assert.deepEqual(payload, {
              message: 'Item already exists',
              cause: { code: 'api/conflict', itemId: 'item-1' },
            });
          const spec = await analyze(join(workspace.path, 'tsconfig.json'), {
            responseAnalyzer,
          });
          assert.ok(
            spec.paths['/items'].get?.responses?.[status],
            `The real HTTP ${status} must be documented`,
          );
          const output = join(workspace.path, 'client');
          await generate(
            {
              openapi: '3.1.0',
              info: { title: 'Items', version: '1.0.0' },
              paths: spec.paths,
              components: spec.components,
            },
            {
              output,
              name: 'Items',
              mode,
              readme: false,
            },
          );
          const source = mode === 'full' ? join(output, 'src') : output;
          await writeFile(
            join(source, 'consumer.ts'),
            `
import assert from 'node:assert/strict';
import { Items, ${status === 400 ? 'BadRequest' : 'Conflict'} as ThrownError, type Endpoints } from './index.ts';

type ThrownResponse = Extract<Endpoints['GET /items']['error'], { status: ${status} }>;
function describe(error: ThrownResponse): string {
  const status: ${status} = error.status;
  const code: ${status === 400 ? 'string' : "'api/conflict'"} = error.data.cause.code;
  ${
    status === 400
      ? `
  if ('errors' in error.data.cause) {
    const formErrors: unknown[] = error.data.cause.formErrors;
    // @ts-expect-error Form errors must remain an array.
    const invalid: string = error.data.cause.formErrors;
    void [formErrors, invalid];
  }
  `
      : `
  // @ts-expect-error Item IDs are strings.
  const invalid: number = error.data.cause.itemId;
  void invalid;
  `
  }
  void [status, code];
  return error.data.message;
}
void describe;

export async function exercise(fetch: typeof globalThis.fetch, expected: unknown) {
  const client = new Items({ baseUrl: 'http://sdk.test', fetch });
  assert.deepEqual(await client.request('GET /items', {}), { id: 'item-1' });
  await assert.rejects(client.request('GET /items', { conflict: 'yes' }), (error) => {
    assert.ok(error instanceof ThrownError);
    assert.equal(error.status, ${status});
    assert.deepEqual(error.data, expected);
    return true;
  });
}
`,
          );
          const config = ts.parseJsonConfigFileContent(
            {
              compilerOptions: {
                target: 'ESNext',
                module: 'ESNext',
                moduleResolution: 'bundler',
                strict: true,
                exactOptionalPropertyTypes: true,
                skipLibCheck: true,
                noEmit: true,
                allowImportingTsExtensions: true,
                types: ['node'],
              },
              include: ['**/*.ts'],
            },
            ts.sys,
            source,
          );
          assert.deepEqual(config.errors, []);
          const diagnostics = ts.getPreEmitDiagnostics(
            ts.createProgram(config.fileNames, config.options),
          );
          assert.equal(
            diagnostics.length,
            0,
            ts.formatDiagnosticsWithColorAndContext(diagnostics, {
              getCanonicalFileName: (file) => file,
              getCurrentDirectory: () => source,
              getNewLine: () => '\n',
            }),
          );
          const bundle = join(workspace.path, 'consumer.mjs');
          await build({
            entryPoints: [join(source, 'consumer.ts')],
            outfile: bundle,
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            logLevel: 'silent',
          });
          await (
            await import(pathToFileURL(bundle).href)
          ).exercise((request: Request) => app.fetch(request), payload);
        } finally {
          stop();
        }
      }),
  ),
);
