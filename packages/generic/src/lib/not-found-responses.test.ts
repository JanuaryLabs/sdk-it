import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

/** Analyzes `route.ts` and returns the document as consumers write it to openapi.json. */
async function documented(route: string) {
  await using workspace = await analysisWorkspace('not-found-responses-', {
    'route.ts': route,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  return JSON.parse(JSON.stringify({ paths, components }));
}

test("a route that returns c.notFound() documents the app's notFound response as its 404", async () => {
  const { paths } = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
declare function findMonitor(id: string): Promise<{ id: string } | undefined>;
/** @openapi getMonitor */
app.get('/monitors/:id', validate(() => ({})), async (c) => {
  const monitor = await findMonitor(c.req.param('id'));
  if (!monitor) return c.notFound();
  return c.json(monitor);
});
app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: 'No such resource' } }, 404),
);
`);

  const responses = paths['/monitors/{id}'].get.responses;
  assert.equal(responses['200'] !== undefined, true);
  assert.deepStrictEqual(
    responses['404'].content['application/json'].schema.properties.error
      .properties.code,
    { type: 'string', enum: ['not_found'] },
  );
});

test("a route that returns c.notFound() in an app with no notFound handler documents Hono's default 404 text", async () => {
  const { paths } = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
declare function findMonitor(id: string): Promise<{ id: string } | undefined>;
/** @openapi getMonitor */
app.get('/monitors/:id', validate(() => ({})), async (c) => {
  const monitor = await findMonitor(c.req.param('id'));
  if (!monitor) return c.notFound();
  return c.json(monitor);
});
`);

  const responses = paths['/monitors/{id}'].get.responses;
  assert.deepStrictEqual(Object.keys(responses['404'].content), ['text/plain']);
  assert.equal(
    Object.values(responses).some(
      (response: any) =>
        response.description === 'Response for 200' &&
        response.content === undefined,
    ),
    false,
    'c.notFound() is not an empty 200',
  );
});

test('a route that never returns c.notFound() documents no 404, even when the app has a notFound handler', async () => {
  const { paths } = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getHealth */
app.get('/health', validate(() => ({})), (c) => c.json({ ok: true }));
app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: 'No such resource' } }, 404),
);
`);

  assert.equal(paths['/health'].get.responses['404'], undefined);
});
