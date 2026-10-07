import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import z from 'zod';

import {
  consume,
  openapi,
  parse,
  validate,
  verifyContentType,
} from '@sdk-it/hono/runtime';

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
  detail: string;
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
    assert.equal(Object.hasOwn(body.cause, 'details'), false);
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
  test('malformed media types have a distinct client error through every public entrypoint', async () => {
    const entrypoints: MiddlewareHandler[] = [
      validate(() => ({})),
      validate('application/json', () => ({})),
      openapi(() => ({})),
      openapi('application/json', () => ({})),
      consume('application/json'),
      async (c, next) => {
        verifyContentType(c.req.header('content-type'), 'application/json');
        await next();
      },
    ];
    for (const middleware of entrypoints) {
      const app = new Hono();
      app.onError((error, c) => {
        if (error instanceof HTTPException) {
          return c.json({ cause: error.cause }, error.status);
        }
        return c.json({ message: error.message }, 500);
      });
      app.post('/', middleware, (c) => c.json({ reached: true }));
      for (const contentType of [
        'not-a-media-type',
        'application/json; charset',
      ]) {
        const rejected = await app.request('/', {
          method: 'POST',
          headers: { 'content-type': contentType },
          body: '{}',
        });
        assert.equal(rejected.status, 415);
        assert.deepEqual(await rejected.json(), {
          cause: {
            code: 'api/unsupported-media-type',
            detail: 'Invalid content type header',
          },
        });
      }
      const accepted = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'Application/JSON; charset=utf-8' },
        body: '{}',
      });
      assert.equal(accepted.status, 200);
      assert.deepEqual(await accepted.json(), { reached: true });
    }
    for (const [actual, detail] of [
      [undefined, 'Missing content type header'],
      [
        'text/plain',
        'Expected content type: application/json, but got: text/plain',
      ],
    ] as const) {
      assert.throws(
        () => verifyContentType(actual, 'application/json'),
        (error) => {
          assert.ok(error instanceof HTTPException);
          assert.equal(error.status, 415);
          assert.deepEqual(error.cause, {
            code: 'api/unsupported-media-type',
            detail,
          });
          return true;
        },
      );
    }
  });

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
    assert.match(body.cause.detail, /GET requests cannot have a content type/);
    assert.equal(Object.hasOwn(body.cause, 'details'), false);
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
    assert.match(body.cause.detail, /Expected content type: application\/json/);
    assert.equal(Object.hasOwn(body.cause, 'details'), false);
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
    assert.equal(body.cause.detail, 'Missing content type header');
    assert.equal(Object.hasOwn(body.cause, 'details'), false);
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

describe('hono validator: canonical request handling', () => {
  test('non-object field selections fail without changing whole-body values or per-request schemas', async () => {
    let fallback = 'first';
    const app = new Hono();
    app.onError((error, c) => {
      if (error instanceof HTTPException)
        return c.json({ cause: error.cause }, error.status);
      return c.json({ message: error.message }, 500);
    });
    app.post(
      '/field',
      validate((payload) => ({
        name: {
          select: payload.body.name,
          against: z.string().default(fallback),
        },
      })),
      (c) => c.json(c.var.input),
    );
    app.post(
      '/whole',
      validate((payload) => ({
        body: { select: payload.body, against: z.unknown() },
      })),
      (c) => c.json(c.var.input),
    );

    for (const value of [null, [], ['value'], 'text', 42, false]) {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      };
      const rejected = await app.request('/field', init);
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), {
        cause: {
          code: 'api/invalid-body',
          detail: 'Request body must be an object when selecting fields.',
        },
      });
      const whole = await app.request('/whole', init);
      assert.equal(whole.status, 200);
      assert.deepEqual(await whole.json(), { body: value });
    }
    for (const [value, expected] of [
      [{ name: 'alice' }, 'alice'],
      [{}, 'first'],
      [{}, 'second'],
    ] as const) {
      const response = await app.request('/field', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { name: expected });
      if (expected === 'first') fallback = 'second';
    }
  });

  test('malformed JSON returns a structured 400 without running the handler', async () => {
    const app = buildApp(
      validate((payload) => ({
        name: { select: payload.body.name, against: z.string() },
      })),
    );
    const response = await app.request('/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      message: 'Invalid JSON body',
      cause: {
        code: 'api/invalid-json',
        detail: 'Request body must be valid JSON.',
      },
    });
  });

  test('retains every repeated URL-encoded form value', async () => {
    const app = new Hono().post(
      '/tags',
      validate('application/x-www-form-urlencoded', (payload) => ({
        tags: { select: payload.body.tag, against: z.array(z.string()) },
        title: { select: payload.body.title, against: z.string() },
      })),
      (c) => c.json(c.var.input),
    );
    const response = await app.request('/tags', {
      method: 'POST',
      body: new URLSearchParams([
        ['tag', 'first'],
        ['tag', 'second'],
        ['title', 'Example'],
      ]),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      tags: ['first', 'second'],
      title: 'Example',
    });
  });

  test('retains multiple files submitted under the same multipart field', async () => {
    const app = new Hono().post(
      '/upload',
      validate('multipart/form-data', (payload) => ({
        files: {
          select: payload.body.files,
          against: z.array(z.instanceof(File)),
        },
      })),
      (c) => c.json(c.var.input.files.map((file) => file.name)),
    );
    const form = new FormData();
    form.append('files', new File(['a'], 'a.txt'));
    form.append('files', new File(['b'], 'b.txt'));
    const response = await app.request('/upload', {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), ['a.txt', 'b.txt']);
  });

  test('keeps query strings literal and applies defaults and async transforms per request', async () => {
    let selections = 0;
    const app = new Hono().get(
      '/items/:id',
      validate((payload) => {
        selections++;
        return {
          id: { select: payload.params.id, against: z.string() },
          name: { select: payload.query.name, against: z.string() },
          tags: { select: payload.queries.tag, against: z.array(z.string()) },
          count: {
            select: payload.query.count,
            against: z
              .string()
              .default('2')
              .transform(async (value) => Number(value)),
          },
          optional: {
            select: payload.query.optional,
            against: z.string().optional(),
          },
        };
      }),
      (c) => {
        const expected: typeof c.var.input = {
          id: c.req.param('id'),
          name: 'null',
          tags: ['null', 'other'],
          count: 2,
        };
        assert.equal(c.var.input.count, expected.count);
        assert.equal(c.var.input.optional, undefined);
        return c.json(c.var.input);
      },
    );
    assert.equal(selections, 0);
    for (const id of ['first', 'second']) {
      const response = await app.request(
        `/items/${id}?name=null&tag=null&tag=other`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id,
        name: 'null',
        tags: ['null', 'other'],
        count: 2,
      });
    }
    assert.equal(selections, 2);
  });

  test('parse accepts a transformed non-object schema and preserves root errors', async () => {
    const app = new Hono();
    app.onError((error, c) => {
      if (error instanceof HTTPException) {
        return c.json(
          { message: error.message, cause: error.cause },
          error.status,
        );
      }
      throw error;
    });
    const schema = z
      .union([z.literal('draft'), z.literal('published')])
      .transform(async (status) => ({ status }));
    app.post('/status', async (c) =>
      c.json(await parse(schema, await c.req.json())),
    );

    const accepted = await app.request('/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"draft"',
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { status: 'draft' });

    const rejected = await app.request('/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"unknown"',
    });
    assert.equal(rejected.status, 400);
    const body = (await rejected.json()) as {
      cause: ValidationCause & {
        formErrors: Array<{ message: string; code: string; path: string }>;
      };
    };
    assert.equal(body.cause.code, 'api/validation-failed');
    assert.deepEqual(body.cause.errors, {});
    assert.equal(body.cause.formErrors.length, 1);
    assert.equal(body.cause.formErrors[0].code, 'invalid_union');
    assert.equal(body.cause.formErrors[0].path, '');
  });

  test('schemas observe closure changes on each request', async () => {
    let fallback = 'first';
    const app = new Hono().get(
      '/defaults',
      validate((payload) => ({
        name: {
          select: payload.query.name,
          against: z.string().default(fallback),
        },
      })),
      (c) => c.json(c.var.input),
    );

    assert.deepEqual(await (await app.request('/defaults')).json(), {
      name: 'first',
    });
    fallback = 'second';
    assert.deepEqual(await (await app.request('/defaults')).json(), {
      name: 'second',
    });
  });

  test('whole-body schemas receive objects, arrays, scalars, and null unchanged', async () => {
    const app = new Hono().post(
      '/body',
      validate('application/json', (payload) => ({
        body: {
          select: payload.body,
          against: z.union([
            z.strictObject({ name: z.string() }),
            z.array(z.string()),
            z.string(),
            z.null(),
          ]),
        },
      })),
      (c) => c.json(c.var.input.body),
    );
    for (const value of [{ name: 'alice' }, ['a', 'b'], 'text', null]) {
      const response = await app.request('/body', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), value);
    }
    const rejected = await app.request('/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice', unexpected: true }),
    });
    assert.equal(rejected.status, 400);
  });

  test('async refinements reject before the route handler runs', async () => {
    let handled = false;
    const app = new Hono().post(
      '/reserved',
      validate((payload) => ({
        name: {
          select: payload.body.name,
          against: z.string().refine(async (name) => name !== 'reserved'),
        },
      })),
      (c) => {
        handled = true;
        return c.json(c.var.input);
      },
    );
    const response = await app.request('/reserved', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'reserved' }),
    });
    assert.equal(response.status, 400);
    assert.equal(handled, false);
  });

  test('a scalar form schema rejects repeated values instead of keeping the last', async () => {
    const app = buildApp(
      validate((payload) => ({
        name: { select: payload.body.name, against: z.string() },
      })),
    );
    const response = await app.request('/things', {
      method: 'POST',
      body: new URLSearchParams([
        ['name', 'first'],
        ['name', 'second'],
      ]),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { cause: ValidationCause };
    assert.equal(body.cause.errors.name[0].code, 'invalid_type');
  });

  test('a bracket-suffixed form field remains an array even with one value', async () => {
    const app = new Hono().post(
      '/tags',
      validate((payload) => ({
        tags: {
          select: payload.body['tags[]'],
          against: z.array(z.string()),
        },
      })),
      (c) => c.json(c.var.input),
    );
    const response = await app.request('/tags', {
      method: 'POST',
      body: new URLSearchParams({ 'tags[]': 'only' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tags: ['only'] });
  });

  test('consume and the openapi alias preserve normalized media types and headers', async () => {
    const app = new Hono().post(
      '/headers',
      consume('application/json'),
      openapi('application/json', (payload) => ({
        name: { select: payload.body.name, against: z.string() },
        token: { select: payload.headers['x-token'], against: z.string() },
        missing: {
          select: payload.headers['x-missing'],
          against: z.string().optional(),
        },
      })),
      (c) => c.json(c.var.input),
    );
    const response = await app.request('/headers', {
      method: 'POST',
      headers: {
        'content-type': 'Application/JSON; charset=utf-8',
        'X-Token': 'secret',
      },
      body: JSON.stringify({ name: 'alice' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: 'alice', token: 'secret' });
  });

  test('parse preserves both root and nested issues from one schema', async () => {
    const schema = z
      .object({ items: z.array(z.string()) })
      .superRefine((_, c) => {
        c.addIssue({ code: 'custom', message: 'Batch rejected' });
        c.addIssue({
          code: 'custom',
          message: 'Item rejected',
          path: ['items', 0],
        });
      });
    const app = new Hono();
    app.onError((error, c) => {
      if (error instanceof HTTPException) {
        return c.json({ cause: error.cause }, error.status);
      }
      throw error;
    });
    app.post('/batch', async (c) =>
      c.json(await parse(schema, await c.req.json())),
    );
    const response = await app.request('/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: ['first'] }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      cause: {
        code: 'api/validation-failed',
        detail: 'The input data is invalid',
        errors: {
          items: [
            { message: 'Item rejected', code: 'custom', path: 'items.0' },
          ],
        },
        formErrors: [{ message: 'Batch rejected', code: 'custom', path: '' }],
      },
    });
  });
});
