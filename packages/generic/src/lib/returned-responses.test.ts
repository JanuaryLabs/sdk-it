import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze, responseAnalyzer } from '@sdk-it/generic';
import { responseAnalyzer as honoResponses } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

/** Analyzes `route.ts` and returns its paths as consumers write them to openapi.json. */
async function documentedPaths(
  responses: typeof responseAnalyzer | typeof honoResponses,
  route: string,
) {
  await using workspace = await analysisWorkspace('returned-responses-', {
    'route.ts': route,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths } = await analyze(project, { responseAnalyzer: responses });
  return JSON.parse(JSON.stringify(paths));
}

test('a response returned inside a callback the Hono handler calls is not documented', async () => {
  const paths = await documentedPaths(
    honoResponses,
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi countPages */
app.get('/pages', validate(() => ({})), (c) => {
  const pages = [1].map((page) => {
    return c.json({ page }, 202);
  });
  return c.json({ count: pages.length });
});
`,
  );

  assert.deepStrictEqual(Object.keys(paths['/pages'].get.responses).sort(), [
    '200',
    '400',
    '415',
  ]);
});

test('a response returned inside a callback the handler calls is not documented by the generic analyzer', async () => {
  const paths = await documentedPaths(
    responseAnalyzer,
    `const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown, _status?: number) => value };
const validate = (selector: unknown) => selector;
app.get('/pages', validate(() => ({})), () => {
  const pages = [1].map((page) => {
    return output.json({ page }, 202);
  });
  return output.json({ count: pages.length });
});
export {};
`,
  );

  assert.deepStrictEqual(Object.keys(paths['/pages'].get.responses), ['200']);
});

test("a concise Hono handler documents the same responses as its block-bodied twin, its c.json() 200 beside validate()'s errors", async () => {
  const paths = await documentedPaths(
    honoResponses,
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getConcise */
app.get('/concise', validate(() => ({})), (c) => c.json({ id: 1 }));
/** @openapi getBlock */
app.get('/block', validate(() => ({})), (c) => {
  return c.json({ id: 1 });
});
`,
  );

  const concise = paths['/concise'].get.responses;
  assert.deepStrictEqual(Object.keys(concise).sort(), ['200', '400', '415']);
  assert.ok(concise['200'].content['application/json'].schema.properties.id);
  assert.deepStrictEqual(concise, paths['/block'].get.responses);
});

test('a concise Hono handler documents the status it passes to c.json()', async () => {
  const paths = await documentedPaths(
    honoResponses,
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi createWidget */
app.post('/widgets', validate(() => ({})), (c) => c.json({ id: 1 }, 201));
`,
  );

  assert.deepStrictEqual(Object.keys(paths['/widgets'].post.responses).sort(), [
    '201',
    '400',
    '415',
  ]);
});

test('an async concise Hono handler documents the same responses as its block-bodied twin', async () => {
  const paths = await documentedPaths(
    honoResponses,
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getConcise */
app.get('/concise', validate(() => ({})), async (c) => c.json({ id: 1 }));
/** @openapi getBlock */
app.get('/block', validate(() => ({})), async (c) => {
  return c.json({ id: 1 });
});
`,
  );

  const concise = paths['/concise'].get.responses;
  assert.ok(concise['200'].content['application/json'].schema.properties.id);
  assert.deepStrictEqual(concise, paths['/block'].get.responses);
});

test('a Hono handler that returns a parenthesized c.json() documents the same responses as one that returns it bare', async () => {
  const paths = await documentedPaths(
    honoResponses,
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getConcise */
app.get('/concise', validate(() => ({})), (c) => (c.json({ id: 1 })));
/** @openapi getBlock */
app.get('/block', validate(() => ({})), (c) => {
  return (c.json({ id: 1 }));
});
/** @openapi getBare */
app.get('/bare', validate(() => ({})), (c) => c.json({ id: 1 }));
`,
  );

  const bare = paths['/bare'].get.responses;
  assert.ok(bare['200']);
  assert.deepStrictEqual(paths['/concise'].get.responses, bare);
  assert.deepStrictEqual(paths['/block'].get.responses, bare);
});

test('a Hono handler with an early return documents each response with its own status and body', async () => {
  const paths = await documentedPaths(
    honoResponses,
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getWidget */
app.get('/widget', validate(() => ({})), (c) => {
  if (c.req.header('x-missing')) {
    return c.json({ error: 'missing' }, 404);
  }
  return c.json({ id: 'w1' });
});
`,
  );

  const { responses } = paths['/widget'].get;
  assert.deepStrictEqual(Object.keys(responses).sort(), [
    '200',
    '400',
    '404',
    '415',
  ]);
  assert.deepStrictEqual(
    Object.keys(responses['404'].content['application/json'].schema.properties),
    ['error'],
  );
  assert.deepStrictEqual(
    Object.keys(responses['200'].content['application/json'].schema.properties),
    ['id'],
  );
});

test('a handler with an early return documents each output response with its own status and body', async () => {
  const paths = await documentedPaths(
    responseAnalyzer,
    `const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown, _status?: number) => value };
const validate = (selector: unknown) => selector;
declare const missing: boolean;
app.get('/widget', validate(() => ({})), () => {
  if (missing) {
    return output.json({ error: 'missing' }, 404);
  }
  return output.json({ id: 'w1' });
});
export {};
`,
  );

  const { responses } = paths['/widget'].get;
  assert.deepStrictEqual(Object.keys(responses).sort(), ['200', '404']);
  assert.deepStrictEqual(
    Object.keys(responses['404'].content['application/json'].schema.properties),
    ['error'],
  );
  assert.deepStrictEqual(
    Object.keys(responses['200'].content['application/json'].schema.properties),
    ['id'],
  );
});

test('a concise handler documents the same output response as its block-bodied twin', async () => {
  const paths = await documentedPaths(
    responseAnalyzer,
    `const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown, _status?: number) => value };
const validate = (selector: unknown) => selector;
app.get('/concise', validate(() => ({})), () => output.json({ id: 'w1' }));
app.get('/block', validate(() => ({})), () => {
  return output.json({ id: 'w1' });
});
export {};
`,
  );

  const concise = paths['/concise'].get.responses;
  assert.ok(concise['200'].content['application/json'].schema.properties.id);
  assert.deepStrictEqual(concise, paths['/block'].get.responses);
});

test('the client generated for a concise Hono handler types its success response', async () => {
  await using workspace = await analysisWorkspace(
    'returned-responses-client-',
    {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getWidget */
app.get('/widget', validate(() => ({})), (c) => c.json({ id: Number('1'), name: String('w') }));
`,
    },
  );
  using project = openAnalysisProject(workspace.tsconfig);
  const spec = await analyze(project, { responseAnalyzer: honoResponses });
  const output = join(workspace.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Widgets', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    { output, name: 'Widgets', readme: false, mode: 'full' },
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));
  const consumerPath = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumerPath,
    `import { createWidgets } from './index.ts';
const client = createWidgets({ baseUrl: 'https://example.test' });
const widget = await client.request('GET /widget', {});
const id: number = widget.id;
const name: string = widget.name;
// @ts-expect-error id is a number.
const wrong: string = widget.id;
void [id, name, wrong];
`,
  );

  const { files, diagnostics } = typecheck(configPath);

  assert.ok(files.includes(consumerPath));
  assert.deepStrictEqual(diagnostics, []);
});
