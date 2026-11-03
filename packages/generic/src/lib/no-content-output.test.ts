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

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const routes = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/**
 * @openapi changePassword
 * @tags me
 */
app.post('/me/password', validate('application/json', (payload) => ({
  password: { select: payload.body.password, against: z.string() },
})), (c) => {
  return c.body(null, 204);
});
`;

test('a 204 route is typed null in the Endpoints output', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-no-content-')),
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
        info: { title: 'Account', version: '1.0.0' },
        paths,
        components,
      },
      { output, name: 'Account', readme: false, mode: 'full' },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import type { Endpoints } from './index.ts';
type IsNever<T> = [T] extends [never] ? true : false;
type Output = Endpoints['POST /me/password']['output'];
const check: IsNever<Output> = false;
const nothing: Output = null;
// @ts-expect-error A 204 response carries no data.
const something: Output = {};
void [check, nothing, something];
`,
    );
    const { files, diagnostics } = typecheck(configPath);
    assert.ok(files.includes(consumerPath));
    assert.deepEqual(diagnostics, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a 204 response resolves without throwing', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-no-content-runtime-')),
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
        info: { title: 'Account', version: '1.0.0' },
        paths,
        components,
      },
      { output, name: 'Account', readme: false, mode: 'full' },
    );
    const { Account } = await import(
      pathToFileURL(join(output, 'src/index.ts')).href
    );
    const client = new Account({
      baseUrl: 'https://example.test',
      fetch: async () => new Response(null, { status: 204 }),
    });
    await client.request('POST /me/password', { password: 'secret' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
