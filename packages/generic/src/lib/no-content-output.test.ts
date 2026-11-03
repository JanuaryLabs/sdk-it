import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
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
  await using dir = await analysisWorkspace('no-content-', {
    'route.ts': routes,
  });

  using project = openAnalysisProject(dir.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  const output = join(dir.path, 'client');
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
});

test('a 204 response resolves without throwing', async () => {
  await using dir = await analysisWorkspace('no-content-runtime-', {
    'route.ts': routes,
  });

  using project = openAnalysisProject(dir.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  const output = join(dir.path, 'client');
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
});
