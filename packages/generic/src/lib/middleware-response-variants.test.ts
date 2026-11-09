import { test } from '@zukhruf/testing/node';
import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

/** Analyzes `route.ts` and returns the document as consumers write it to openapi.json. */
async function documented(route: string) {
  await using workspace = await analysisWorkspace(
    'middleware-response-variants-',
    { 'route.ts': route },
  );
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  return JSON.parse(JSON.stringify({ paths, components }));
}

test("every route using validate() points at one 400 component that lists each of validate()'s bodies once", async () => {
  const { paths, components } = await documented(`import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi createItem */
app.post('/items', validate('application/json', (payload) => ({
  name: { select: payload.body.name, against: z.string() },
})), (c) => c.json({ ok: true }));
/** @openapi createOther */
app.post('/others', validate('application/json', (payload) => ({
  title: { select: payload.body.title, against: z.string() },
})), (c) => c.json({ ok: true }));
`);

  for (const path of ['/items', '/others']) {
    assert.deepStrictEqual(
      paths[path].post.responses['400'].content['application/json'].schema,
      { $ref: '#/components/schemas/validate400_application_json' },
    );
  }
  const bodies = components.schemas.validate400_application_json.oneOf;
  assert.ok(Array.isArray(bodies) && bodies.length > 1);
  assert.equal(
    new Set(bodies.map((body: unknown) => JSON.stringify(body))).size,
    bodies.length,
  );
});

test("validate()'s 400 component documents its invalid-JSON, invalid-body and validation-failed bodies, the last with its field issues", async () => {
  const { components } = await documented(`import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi createItem */
app.post('/items', validate('application/json', (payload) => ({
  name: { select: payload.body.name, against: z.string() },
})), (c) => c.json({ ok: true }));
`);

  const bodies = components.schemas.validate400_application_json.oneOf;
  const causes = bodies.map((body: any) => body.properties.cause.properties);
  assert.deepStrictEqual(
    causes.flatMap((cause: any) => cause.code.enum).sort(),
    ['api/invalid-body', 'api/invalid-json', 'api/validation-failed'],
  );
  const failed = causes.find(
    (cause: any) => cause.code.enum[0] === 'api/validation-failed',
  );
  assert.deepStrictEqual(
    Object.keys(failed.errors.additionalProperties.items.properties).sort(),
    ['code', 'message', 'path'],
  );
});

test("validate()'s 415 component documents exactly the content-type rejections the app sends", async () => {
  await using workspace = await analysisWorkspace('middleware-response-415-', {
    'route.ts': `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ message: error.message, cause: error.cause }, error.status);
  throw error;
});
/** @openapi listItems */
app.get('/items', validate(() => ({})), (c) => c.json({ items: [] }));
/** @openapi createItem */
app.post('/items', validate('application/json', (payload) => ({
  name: { select: payload.body.name, against: z.string() },
})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { components } = JSON.parse(
    JSON.stringify(await analyze(project, { responseAnalyzer })),
  );
  const { app }: { app: Hono } = await import(
    pathToFileURL(join(workspace.path, 'route.ts')).href
  );

  const rejected = await Promise.all([
    app.request('/items', { headers: { 'content-type': 'application/json' } }),
    // A string body would carry text/plain; bytes carry no content type.
    app.request('/items', {
      method: 'POST',
      body: new TextEncoder().encode('{}'),
    }),
    app.request('/items', {
      method: 'POST',
      headers: { 'content-type': ';' },
      body: '{}',
    }),
    app.request('/items', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }),
  ]);

  const documented = components.schemas.validate415_application_json.oneOf.map(
    (body: any) => body.properties.cause.properties.detail,
  );
  const sentDetails = await Promise.all(
    rejected.map(async (response) => {
      assert.equal(response.status, 415);
      return (await response.json()).cause.detail;
    }),
  );
  const documents = (detail: any, sent: string) =>
    detail.enum ? detail.enum.includes(sent) : detail.type === 'string';
  for (const sent of sentDetails) {
    assert.ok(
      documented.some((detail: any) => documents(detail, sent)),
      `"${sent}" is documented`,
    );
  }
  for (const detail of documented) {
    assert.ok(
      sentDetails.some((sent) => documents(detail, sent)),
      `${JSON.stringify(detail)} is a detail the app sends`,
    );
  }
  assert.equal(new Set(sentDetails).size, documented.length);
});

test('a named middleware that rejects with two different bodies for one status documents both in its shared component', async () => {
  const { paths, components } =
    await documented(`import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
const authenticate = (): MiddlewareHandler => async (c, next) => {
  const token = c.req.header('authorization');
  if (!token) {
    throw new HTTPException(401, { message: 'Missing token' });
  }
  if (token === 'expired') {
    throw new HTTPException(401, { message: 'Expired token' });
  }
  await next();
};
/** @openapi getAccount */
app.get('/account', authenticate(), validate(() => ({})), (c) => c.json({ id: 'a1' }));
`);

  const [ct] = Object.keys(paths['/account'].get.responses['401'].content);
  const shared =
    components.schemas[`authenticate401_${ct.replace(/\//g, '_')}`];
  assert.deepStrictEqual(
    shared.oneOf.flatMap((body: any) => body.properties.message.enum).sort(),
    ['Expired token', 'Missing token'],
  );
});

test('a named middleware that rejects with one body per status keeps that body as its shared component', async () => {
  const { paths, components } =
    await documented(`import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
const authenticate = (): MiddlewareHandler => async (c, next) => {
  if (!c.req.header('authorization')) {
    throw new HTTPException(401, { message: 'Missing token' });
  }
  await next();
};
/** @openapi getAccount */
app.get('/account', authenticate(), validate(() => ({})), (c) => c.json({ id: 'a1' }));
/** @openapi getProfile */
app.get('/profile', authenticate(), validate(() => ({})), (c) => c.json({ id: 'p1' }));
`);

  const [ct] = Object.keys(paths['/account'].get.responses['401'].content);
  const name = `authenticate401_${ct.replace(/\//g, '_')}`;
  for (const path of ['/account', '/profile']) {
    assert.deepStrictEqual(
      paths[path].get.responses['401'].content[ct].schema,
      {
        $ref: `#/components/schemas/${name}`,
      },
    );
  }
  assert.equal(components.schemas[name].oneOf, undefined);
  assert.deepStrictEqual(components.schemas[name].properties.message.enum, [
    'Missing token',
  ]);
});

test('each 400 body the app sends for a rejected request is a body validate() documents', async () => {
  await using workspace = await analysisWorkspace('middleware-response-wire-', {
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
})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { components } = JSON.parse(
    JSON.stringify(await analyze(project, { responseAnalyzer })),
  );
  const { app }: { app: Hono } = await import(
    pathToFileURL(join(workspace.path, 'route.ts')).href
  );

  const rejected = await Promise.all(
    ['{', '[]', '{}'].map((body) =>
      app.request('/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    ),
  );

  const documentedCauses =
    components.schemas.validate400_application_json.oneOf.map(
      (body: any) => body.properties.cause.properties,
    );
  const sentCauses = await Promise.all(
    rejected.map(async (response) => {
      assert.equal(response.status, 400);
      return (await response.json()).cause;
    }),
  );
  assert.deepStrictEqual(sentCauses.map((cause) => cause.code).sort(), [
    'api/invalid-body',
    'api/invalid-json',
    'api/validation-failed',
  ]);
  for (const cause of sentCauses) {
    const documentedCause = documentedCauses.find(
      (documented: any) => documented.code.enum[0] === cause.code,
    );
    assert.ok(documentedCause, `${cause.code} is documented`);
    assert.deepStrictEqual(documentedCause.detail.enum, [cause.detail]);
  }
});
