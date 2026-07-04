import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import z from 'zod';

import { validate } from '@sdk-it/hono/runtime';

interface ValidationCause {
  code: string;
  detail: string;
  errors: Record<
    string,
    Array<{ message: string; code: string; path: string; fatal?: boolean }>
  >;
}

interface UnsupportedMediaCause {
  code: string;
  details: string;
}

function buildApp(handler: MiddlewareHandler) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ message: err.message, cause: err.cause }, err.status);
    }
    return c.json({ message: 'unknown' }, 500);
  });
  app.post('/things', handler, (c) => c.json({ ok: true }));
  app.get('/things', handler, (c) => c.json({ ok: true }));
  return app;
}

async function postJson(app: Hono, body: unknown) {
  return app.request('/things', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('hono validator: body validation', () => {
  test('missing required field returns 400 with field error entry', async () => {
    const middleware = validate((payload) => ({
      name: { select: payload.body.name, against: z.string() },
    }));
    const app = buildApp(middleware);

    const res = await postJson(app, {});
    assert.equal(res.status, 400);

    const body = (await res.json()) as {
      message: string;
      cause: ValidationCause;
    };
    assert.equal(body.message, 'Validation failed');
    assert.equal(body.cause.code, 'api/validation-failed');
    assert.equal(body.cause.detail, 'The input data is invalid');
    assert.ok(Array.isArray(body.cause.errors.name));
    assert.equal(body.cause.errors.name.length, 1);
    const entry = body.cause.errors.name[0];
    assert.equal(entry.code, 'invalid_type');
    assert.equal(entry.path, 'name');
    assert.equal(typeof entry.message, 'string');
  });

  test('error entries expose exactly message/code/path — the v3 fatal field is gone on zod 4 issues', async () => {
    const middleware = validate((payload) => ({
      name: { select: payload.body.name, against: z.string() },
    }));
    const app = buildApp(middleware);

    const res = await postJson(app, {});
    const body = (await res.json()) as {
      cause: ValidationCause;
    };
    const entry = body.cause.errors.name[0];
    assert.deepStrictEqual(Object.keys(entry).sort(), [
      'code',
      'message',
      'path',
    ]);
  });

  test('type mismatch yields invalid_type code', async () => {
    const middleware = validate((payload) => ({
      age: { select: payload.body.age, against: z.number() },
    }));
    const app = buildApp(middleware);

    const res = await postJson(app, { age: 'not-a-number' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { cause: ValidationCause };
    const entry = body.cause.errors.age[0];
    assert.equal(entry.code, 'invalid_type');
    assert.equal(entry.path, 'age');
  });

  test('enum violation reports the offending field', async () => {
    const middleware = validate((payload) => ({
      sort: {
        select: payload.body.sort,
        against: z.enum(['asc', 'desc']),
      },
    }));
    const app = buildApp(middleware);

    const res = await postJson(app, { sort: 'bogus' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { cause: ValidationCause };
    assert.ok(Array.isArray(body.cause.errors.sort));
    assert.equal(body.cause.errors.sort.length, 1);
    const entry = body.cause.errors.sort[0];
    assert.equal(entry.path, 'sort');
    assert.ok(
      entry.code === 'invalid_value',
      `expected enum-violation code, got ${entry.code}`,
    );
    assert.equal(typeof entry.message, 'string');
    assert.ok(entry.message.length > 0);
  });

  test('nested object failure dot-joins the path', async () => {
    const middleware = validate((payload) => ({
      profile: {
        select: payload.body.profile,
        against: z.object({ email: z.string() }),
      },
    }));
    const app = buildApp(middleware);

    const res = await postJson(app, { profile: {} });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { cause: ValidationCause };
    const entry = body.cause.errors.profile[0];
    assert.equal(entry.path, 'profile.email');
    assert.equal(entry.code, 'invalid_type');
  });

  test('multiple field errors surface in fieldErrors map', async () => {
    const middleware = validate((payload) => ({
      name: { select: payload.body.name, against: z.string() },
      age: { select: payload.body.age, against: z.number() },
    }));
    const app = buildApp(middleware);

    const res = await postJson(app, { age: 'no' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { cause: ValidationCause };
    assert.ok(body.cause.errors.name, 'name has errors');
    assert.ok(body.cause.errors.age, 'age has errors');
    assert.equal(body.cause.errors.name[0].code, 'invalid_type');
    assert.equal(body.cause.errors.age[0].code, 'invalid_type');
  });

  test('parse success passes data through and runs handler', async () => {
    const middleware = validate((payload) => ({
      name: { select: payload.body.name, against: z.string() },
    }));
    const app = buildApp(middleware);

    const res = await postJson(app, { name: 'alice' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

describe('hono validator: content-type handling', () => {
  test('GET with content-type header is rejected with 415', async () => {
    const middleware = validate((payload) => ({
      q: { select: payload.query.q, against: z.string() },
    }));
    const app = buildApp(middleware);

    const res = await app.request('/things?q=hi', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    assert.equal(res.status, 415);
    const body = (await res.json()) as {
      message: string;
      cause: UnsupportedMediaCause;
    };
    assert.equal(body.message, 'Unsupported Media Type');
    assert.equal(body.cause.code, 'api/unsupported-media-type');
    assert.match(body.cause.details, /GET requests cannot have a content type/);
  });

  test('unsupported content-type returns 415 when expected type set', async () => {
    const middleware = validate('application/json', (payload) => ({
      name: { select: payload.body.name, against: z.string() },
    }));
    const app = buildApp(middleware);

    const res = await app.request('/things', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hi',
    });

    assert.equal(res.status, 415);
    const body = (await res.json()) as {
      message: string;
      cause: UnsupportedMediaCause;
    };
    assert.equal(body.message, 'Unsupported Media Type');
    assert.equal(body.cause.code, 'api/unsupported-media-type');
    assert.match(
      body.cause.details,
      /Expected content type: application\/json/,
    );
  });

  test('missing content-type with expected type returns 415', async () => {
    const middleware = validate('application/json', (payload) => ({
      name: { select: payload.body.name, against: z.string() },
    }));
    const app = buildApp(middleware);

    const res = await app.request('/things', { method: 'POST' });

    assert.equal(res.status, 415);
    const body = (await res.json()) as {
      cause: UnsupportedMediaCause;
    };
    assert.equal(body.cause.details, 'Missing content type header');
  });

  test('unknown content-type falls through to empty body validation', async () => {
    const middleware = validate((payload) => ({
      name: { select: payload.body.name, against: z.string() },
    }));
    const app = buildApp(middleware);

    const res = await app.request('/things', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'binary-blob',
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { cause: ValidationCause };
    assert.ok(body.cause.errors.name, 'name field error present');
    assert.equal(body.cause.errors.name[0].code, 'invalid_type');
    assert.equal(body.cause.errors.name[0].path, 'name');
  });
});
