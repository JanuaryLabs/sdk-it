import { test } from '@zukhruf/parameterized-test';
import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

/** Analyzes `route.ts` and returns the document as consumers write it to openapi.json. */
async function documented(route: string, files: Record<string, string> = {}) {
  await using workspace = await analysisWorkspace('error-handler-responses-', {
    'route.ts': route,
    ...files,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  return JSON.parse(JSON.stringify({ paths, components }));
}

function bodyOf(responses: any, status: string) {
  const schema = responses[status]?.content?.['application/json']?.schema;
  return schema;
}

/** The JSON body schema of `responses[status]`, through a `$ref` into components. */
function resolvedBody(
  document: { paths: any; components: any },
  responses: any,
  status: string,
) {
  const schema = bodyOf(responses, status);
  const ref: string | undefined = schema?.$ref;
  return ref
    ? document.components.schemas[ref.replace('#/components/schemas/', '')]
    : schema;
}

test("a route that throws an error class documents what app.onError's branch for that class sends", async () => {
  const { paths } = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {
  code = 'llm/unavailable';
}
/** @openapi listProviderModels */
app.get('/providers/models', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError('The provider did not answer');
  }
  return c.json({ models: ['a'] });
});
app.onError((error, c) => {
  if (error instanceof LlmError) {
    return c.json({ error: error.message, cause: { code: error.code } }, 502);
  }
  return c.json({ error: 'Internal Server Error' }, 500);
});
`);

  const responses = paths['/providers/models'].get.responses;
  const body = bodyOf(responses, '502');
  assert.ok(body, 'the route documents the 502 its LlmError becomes');
  assert.deepStrictEqual(
    bodyOf(responses, '500'),
    { $ref: '#/components/schemas/validate500_application_json' },
    "the 500 is validate()'s fallthrough alone; the LlmError adds no body to it",
  );
  assert.equal(
    body.oneOf,
    undefined,
    "the 502 is the LlmError branch's one body; no other throw takes that branch",
  );
  assert.deepStrictEqual(Object.keys(body.properties).sort(), [
    'cause',
    'error',
  ]);
});

test("a thrown HTTPException documents app.onError's body for it, with the status the throw gives, not Hono's default text", async () => {
  const { paths } = await documented(`import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getMonitor */
app.get('/monitors/:id', validate(() => ({})), (c) => {
  if (!c.req.param('id').startsWith('m_')) {
    throw new HTTPException(422, { message: 'Bad id' });
  }
  return c.json({ id: c.req.param('id') });
});
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: { code: 'invalid_argument', message: error.message } }, error.status);
  }
  return c.json({ error: { code: 'internal', message: 'Internal Server Error' } }, 500);
});
`);

  const body = bodyOf(paths['/monitors/{id}'].get.responses, '422');
  assert.ok(
    body,
    'the 422 the throw gives is documented with the handler body',
  );
  assert.deepStrictEqual(Object.keys(body.properties), ['error']);
  assert.deepStrictEqual(
    body.properties.error.properties.message,
    { type: 'string', enum: ['Bad id'] },
    "the throw's message literal is bound into the body",
  );
});

test("an HTTPException thrown with no status documents app.onError's branch for it at Hono's default 500", async () => {
  // hono/dist/http-exception.js: constructor(status = 500, options).
  const { paths } = await documented(`import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getMonitor */
app.get('/monitors/:id', validate(() => ({})), (c) => {
  if (!c.req.param('id').startsWith('m_')) {
    throw new HTTPException();
  }
  return c.json({ id: c.req.param('id') });
});
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: { code: 'http' }, status: error.status }, error.status);
  }
  return c.json({ error: { code: 'internal' } }, 500);
});
`);

  const body = bodyOf(paths['/monitors/{id}'].get.responses, '500');
  assert.deepStrictEqual(
    body?.properties?.error?.properties?.code,
    { type: 'string', enum: ['http'] },
    "the status-less HTTPException takes the HTTPException branch at Hono's 500, not the fallthrough",
  );
  assert.deepStrictEqual(
    body?.properties?.status,
    { type: 'number', enum: [500] },
    'a body that sends the default status documents it as the literal 500',
  );
});

test("a thrown error that no app.onError branch narrows documents the handler's fallthrough response", async () => {
  const { paths } = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class QuotaError extends Error {}
class LlmError extends Error {}
/** @openapi createReport */
app.post('/reports', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new QuotaError('Over quota');
  }
  return c.json({ id: 'r1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof LlmError) {
    return c.json({ error: error.message }, 502);
  }
  return c.json({ error: { code: 'internal' } }, 500);
});
`);

  const responses = paths['/reports'].post.responses;
  assert.equal(responses['502'], undefined, 'QuotaError is not an LlmError');
  assert.ok(bodyOf(responses, '500'), 'the fallthrough 500 is documented');
});

test("a route whose only throws are validate()'s documents the fallthrough app.onError sends for them, and no branch for a class nothing throws", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
/** @openapi getHealth */
app.get('/health', validate(() => ({})), (c) => c.json({ ok: true }));
app.onError((error, c) => {
  if (error instanceof LlmError) {
    return c.json({ error: error.message }, 502);
  }
  return c.json({ error: { code: 'internal' } }, 500);
});
`);

  const responses = document.paths['/health'].get.responses;
  assert.equal(responses['502'], undefined, 'nothing throws an LlmError');
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '500')?.properties ?? {}),
    ['error'],
    "validate()'s HTTPException falls through to the 500",
  );
});

test('an error that app.onError re-throws documents no response, because Hono sends none and the server adapter answers', async () => {
  // hono-base.js:313-314 hands the re-thrown error to #handleError, which calls the same
  // handler again (271-273); it throws again and app.fetch rejects. @hono/node-server
  // answers that rejection with an empty 500 (listener.mjs:406-407, 484).
  const document = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
class QuotaError extends Error {}
/** @openapi createReport */
app.post('/reports', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError('The provider did not answer');
  }
  if (Math.random() > 0.5) {
    throw new QuotaError('Over quota');
  }
  return c.json({ id: 'r1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof LlmError) {
    return c.json({ error: error.message }, 502);
  }
  throw error;
});
`);

  const responses = document.paths['/reports'].post.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '502')?.properties ?? {}),
    ['error'],
    'the LlmError branch is documented',
  );
  assert.equal(
    responses['500'],
    undefined,
    'the re-thrown QuotaError gets no documented response',
  );
});

test('an HTTPException that app.onError throws documents no response at its status, because a throw inside the handler is never a response', async () => {
  const document = await documented(`import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
class QuotaError extends Error {}
/** @openapi createReport */
app.post('/reports', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError('The provider did not answer');
  }
  if (Math.random() > 0.5) {
    throw new QuotaError('Over quota');
  }
  return c.json({ id: 'r1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof LlmError) {
    return c.json({ error: error.message }, 502);
  }
  throw new HTTPException(418, { message: 'teapot' });
});
`);

  const responses = document.paths['/reports'].post.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '502')?.properties ?? {}),
    ['error'],
    'the LlmError branch is documented',
  );
  assert.equal(
    responses['418'],
    undefined,
    "the handler's own HTTPException is not a response",
  );
});

test("an error whose class extends the class an app.onError branch narrows documents that branch's body, not the fallthrough", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
class QuotaError extends LlmError {}
/** @openapi createReport */
app.post('/reports', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new QuotaError('x');
  }
  return c.json({ id: 'r1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof LlmError) return c.json({ error: error.message }, 502);
  return c.json({ fault: 'internal' }, 500);
});
`);

  const responses = document.paths['/reports'].post.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '502')?.properties ?? {}),
    ['error'],
    'the QuotaError is an LlmError',
  );
  assert.deepStrictEqual(
    bodyOf(responses, '500'),
    { $ref: '#/components/schemas/validate500_application_json' },
    "fault comes only from validate()'s fallthrough, never for the QuotaError",
  );
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '500').properties),
    ['fault'],
  );
});

test("a spread that app.onError's body guards with instanceof keeps its properties only for the throws of that class", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
class QuotaError extends Error {}
/** @openapi createReport */
app.post('/reports', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError('The provider did not answer');
  }
  if (Math.random() > 0.5) {
    throw new QuotaError('Over quota');
  }
  return c.json({ id: 'r1' }, 201);
});
app.onError((error, c) =>
  c.json({ error: error.message, ...(error instanceof LlmError && { hint: 'retry' }) }, 500),
);
`);

  const responses = document.paths['/reports'].post.responses;
  const thrown = bodyOf(responses, '500').oneOf.filter(
    (body: any) => !body.$ref,
  );
  assert.deepStrictEqual(
    thrown.map((body: any) => Object.keys(body.properties)),
    [['error', 'hint'], ['error']],
    'the LlmError has hint and the QuotaError has none',
  );
});

test('a concise app.onError conditional documents its true branch for the class it narrows and its false branch for any other throw', async () => {
  const document = await documented(`import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class QuotaError extends Error {}
/** @openapi getMonitor */
app.get('/monitors/:id', validate(() => ({})), (c) => {
  if (!c.req.param('id').startsWith('m_')) {
    throw new HTTPException(422, { message: 'Bad id' });
  }
  if (Math.random() > 0.5) {
    throw new QuotaError('Over quota');
  }
  return c.json({ id: c.req.param('id') });
});
app.onError((error, c) =>
  error instanceof HTTPException
    ? c.json({ error: { code: 'http', message: error.message } }, error.status)
    : c.json({ fault: 'internal' }, 500),
);
`);

  const responses = document.paths['/monitors/{id}'].get.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '422')?.properties ?? {}),
    ['error'],
    "the 422 carries the conditional's true branch, not the HTTPException options",
  );
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '500')?.properties ?? {}),
    ['fault'],
    "the QuotaError gets the conditional's false branch",
  );
});

/** Every JSON body schema `responses[status]` documents, through `$ref`s and `oneOf`. */
function bodiesOf(
  document: { paths: any; components: any },
  responses: any,
  status: string,
): any[] {
  const expand = (schema: any): any[] => {
    if (!schema) {
      return [];
    }
    if (schema.$ref) {
      return expand(
        document.components.schemas[
          schema.$ref.replace('#/components/schemas/', '')
        ],
      );
    }
    return schema.oneOf ? schema.oneOf.flatMap(expand) : [schema];
  };
  return expand(bodyOf(responses, status));
}

test("a thrown HTTPException's object-literal cause keeps its literals in app.onError's body, so its code is a const", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi continueWithGoogle */
app.post('/auth/google', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new HTTPException(400, {
      message: 'Google authorization belongs to another app',
      cause: { code: 'google/invalid-grant', detail: 'Continue with Google from this app.' },
    });
  }
  return c.json({ ok: true });
});
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message, cause: error.cause }, error.status);
  }
  return c.json({ error: 'internal' }, 500);
});
`);

  const responses = document.paths['/auth/google'].post.responses;
  const google = bodiesOf(document, responses, '400').find(
    (body) =>
      body.properties?.cause?.properties?.code?.enum?.[0] ===
      'google/invalid-grant',
  );
  assert.ok(google, 'the 400 carries the cause the throw gives');
  assert.deepStrictEqual(google.properties.cause.properties.code, {
    type: 'string',
    enum: ['google/invalid-grant'],
  });
  assert.deepStrictEqual(google.properties.error, {
    type: 'string',
    enum: ['Google authorization belongs to another app'],
  });
});

test('a program that registers app.onError twice fails analyze, naming both handlers', async () => {
  await using workspace = await analysisWorkspace('error-handler-two-', {
    'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
export const admin = new Hono();
/** @openapi getHealth */
app.get('/health', validate(() => ({})), (c) => c.json({ ok: true }));
app.onError((error, c) => c.json({ error: error.message }, 500));
admin.onError((error, c) => c.json({ fault: error.message }, 500));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  await assert.rejects(analyze(project, { responseAnalyzer }), (error) => {
    assert.ok(Error.isError(error));
    assert.match(error.message, /route\.ts:7:\d+/);
    assert.match(error.message, /route\.ts:8:\d+/);
    return true;
  });
});

function refusals(
  table: string,
  send = 'c.json({ code: error.code }, refusalStatus[error.code])',
) {
  return `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
type RefusalCode = 'patient_not_found' | 'already_booked';
${table}
class Refusal extends Error {
  constructor(readonly code: RefusalCode) {
    super(code);
  }
}
/** @openapi book */
app.post('/bookings', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new Refusal(Math.random() > 0.5 ? 'already_booked' : 'patient_not_found');
  }
  return c.json({ id: 'b1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof Refusal) {
    return ${send};
  }
  return c.json({ error: 'internal' }, 500);
});
`;
}

test('a status read from a table annotated with a union of statuses fails analyze, naming the throw site, the status and the fix', async () => {
  await using workspace = await analysisWorkspace('error-handler-status-', {
    'route.ts': refusals(
      `const refusalStatus: Record<RefusalCode, 400 | 404> = { patient_not_found: 404, already_booked: 400 };`,
    ),
  });
  using project = openAnalysisProject(workspace.tsconfig);

  await assert.rejects(analyze(project, { responseAnalyzer }), (error) => {
    assert.ok(Error.isError(error));
    assert.match(error.message, /thrown at \S*route\.ts:14:\d+/);
    assert.match(
      error.message,
      /refusalStatus\[error\.code\], whose type is 400 \| 404/,
    );
    assert.match(
      error.message,
      /Declare refusalStatus as const satisfies Record<RefusalCode, 400 \| 404>/,
    );
    return true;
  });
});

test('a status read from a table declared as const documents each code at its own status', async () => {
  const document = await documented(
    refusals(
      `const refusalStatus = { patient_not_found: 404, already_booked: 400 } as const satisfies Record<RefusalCode, 400 | 404>;`,
    ),
  );

  const responses = document.paths['/bookings'].post.responses;
  const codes = (status: string) =>
    bodiesOf(document, responses, status).flatMap(
      (body) => body.properties?.code?.enum ?? [],
    );
  assert.deepStrictEqual(codes('404'), ['patient_not_found']);
  assert.deepStrictEqual(codes('400'), ['already_booked']);
});

function helperStatus(body: string) {
  return `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
function conflict(status: ContentfulStatusCode): never {
  throw new HTTPException(status, { message: 'x' });
}
/** @openapi book */
app.post('/bookings', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    conflict(409);
  }
  return c.json({ id: 'b1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json(${body}, error.status);
  }
  return c.json({ error: 'internal' }, 500);
});
`;
}

void test.each(
  [
    ['', '{ error: error.message }'],
    [
      ', also when the body reads the status',
      '{ error: error.message, status: error.status }',
    ],
  ],
  ([reads, body]) =>
    test(`an HTTPException whose status is a helper's ContentfulStatusCode parameter fails analyze, naming the throw site and asking for a literal status there${reads}`, async () => {
      await using workspace = await analysisWorkspace('error-handler-status-', {
        'route.ts': helperStatus(body),
      });
      using project = openAnalysisProject(workspace.tsconfig);

      await assert.rejects(analyze(project, { responseAnalyzer }), (error) => {
        assert.ok(Error.isError(error));
        assert.match(error.message, /thrown at \S*route\.ts:7:\d+/);
        assert.match(error.message, /the status error\.status, whose type is /);
        assert.match(
          error.message,
          /Pass a number literal as the status where the error is constructed, at \S*route\.ts:7:\d+/,
        );
        return true;
      });
    }),
);

test('an app.onError handler passed by reference to its function declaration documents its branch for the class a route throws', async () => {
  const document = await documented(`import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
/** @openapi listProviderModels */
app.get('/providers/models', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError('The provider did not answer');
  }
  return c.json({ models: ['a'] });
});
function handleError(error: Error, c: Context) {
  if (error instanceof LlmError) {
    return c.json({ error: error.message }, 502);
  }
  return c.json({ fault: 'internal' }, 500);
}
app.onError(handleError);
`);

  const responses = document.paths['/providers/models'].get.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '502')?.properties ?? {}),
    ['error'],
    'the route documents the 502 handleError sends for its LlmError',
  );
});

test('an app.onError handler that analyze cannot resolve to a function with a body fails analyze, naming the onError call', async () => {
  await using workspace = await analysisWorkspace('error-handler-unresolved-', {
    'route.ts': `import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getHealth */
app.get('/health', validate(() => ({})), (c) => c.json({ ok: true }));
const errorHandlerFor = (name: string) => (error: Error, c: Context) =>
  c.json({ error: name }, 500);
app.onError(errorHandlerFor('api'));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  await assert.rejects(analyze(project, { responseAnalyzer }), (error) => {
    assert.ok(Error.isError(error));
    assert.match(error.message, /app\.onError at \S*route\.ts:8:\d+/);
    assert.match(error.message, /errorHandlerFor\('api'\)/);
    return true;
  });
});

test("a middleware factory's own throw runs when the app is built, so it documents no response, while a throw in the middleware it returns does", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class Forbidden extends Error {}
const guard = (name: string) => {
  if (!name) throw new Error('name required');
  return createMiddleware(async (c, next) => {
    if (c.req.header('x-name') !== name) {
      throw new Forbidden('Not allowed');
    }
    await next();
  });
};
/** @openapi getHealth */
app.get('/health', guard('admin'), validate(() => ({})), (c) => c.json({ ok: true }));
app.onError((error, c) => {
  if (error instanceof Forbidden) {
    return c.json({ denied: error.message }, 403);
  }
  if (error instanceof HTTPException) {
    return c.json({ invalid: error.message }, error.status);
  }
  return c.json({ error: 'internal' }, 500);
});
`);

  const responses = document.paths['/health'].get.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '403')?.properties ?? {}),
    ['denied'],
    'the Forbidden the returned middleware throws is documented',
  );
  assert.equal(
    responses['500'],
    undefined,
    "the factory's own throw is not a response",
  );
});

const asConstTable = `const refusalStatus = { patient_not_found: 404, already_booked: 400 } as const satisfies Record<RefusalCode, 400 | 404>;`;

test("a status read from an as-const table at a code the body does not send documents a response at each code's status", async () => {
  const document = await documented(
    refusals(
      asConstTable,
      'c.json({ error: error.message }, refusalStatus[error.code])',
    ),
  );

  const responses = document.paths['/bookings'].post.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '404')?.properties ?? {}),
    ['error'],
  );
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '400')?.properties ?? {}),
    ['error'],
  );
});

test("a status that a conditional on the error's code decides documents each code at the status its branch sends", async () => {
  const document = await documented(
    refusals(
      asConstTable,
      "c.json({ code: error.code }, error.code === 'patient_not_found' ? 404 : 400)",
    ),
  );

  const responses = document.paths['/bookings'].post.responses;
  const codes = (status: string) =>
    bodiesOf(document, responses, status).flatMap(
      (body) => body.properties?.code?.enum ?? [],
    );
  assert.deepStrictEqual(codes('404'), ['patient_not_found']);
  assert.deepStrictEqual(codes('400'), ['already_booked']);
});

test('a status read from an as-const table at a key that is no literal fails analyze, saying the key is the problem, not the table', async () => {
  await using workspace = await analysisWorkspace('error-handler-status-', {
    'route.ts': refusals(
      asConstTable,
      'c.json({ code: error.code }, refusalStatus[error.message as RefusalCode])',
    ),
  });
  using project = openAnalysisProject(workspace.tsconfig);

  await assert.rejects(analyze(project, { responseAnalyzer }), (error) => {
    assert.ok(Error.isError(error));
    assert.match(
      error.message,
      /The key error\.message as RefusalCode has the type RefusalCode, not one literal/,
    );
    assert.doesNotMatch(error.message, /Declare refusalStatus as const/);
    return true;
  });
});

test("an onError or notFound method of an object that is not a Hono app registers no app handler, and the app's own handlers still document", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
interface Reply {
  json(body: unknown, status: number): Response;
}
class Socket {
  onError(callback: (error: Error) => void) {
    return callback;
  }
  notFound(callback: (reply: Reply) => Response) {
    return callback;
  }
}
const socket = new Socket();
declare const reconnect: (error: Error) => void;
socket.onError(reconnect);
socket.notFound((reply) => reply.json({ socket: true }, 404));
/** @openapi getModel */
app.get('/models/:id', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError('The provider did not answer');
  }
  if (Math.random() > 0.5) {
    return c.notFound();
  }
  return c.json({ id: 'm1' });
});
app.notFound((c) => c.json({ missing: true }, 404));
app.onError((error, c) =>
  error instanceof LlmError
    ? c.json({ error: error.message }, 502)
    : c.json({ fault: 'internal' }, 500),
);
`);

  const responses = document.paths['/models/{id}'].get.responses;
  assert.deepStrictEqual(
    Object.keys(resolvedBody(document, responses, '502')?.properties ?? {}),
    ['error'],
    "the app's onError documents the LlmError",
  );
  assert.deepStrictEqual(
    bodiesOf(document, responses, '404').map((body) =>
      Object.keys(body.properties ?? {}),
    ),
    [['missing']],
    "c.notFound() documents only the app's notFound body",
  );
});

const branch =
  "error instanceof LlmError ? c.json({ error: error.message }, 502) : c.json({ fault: 'internal' }, 500)";

void test.each(
  [
    [
      'a property whose value is an arrow function',
      `const handlers = { handleError: (error: Error, c: Context) => ${branch} };`,
    ],
    [
      'a shorthand property',
      `const handleError = (error: Error, c: Context) => ${branch};\nconst handlers = { handleError };`,
    ],
    [
      'a method',
      `const handlers = {\n  handleError(error: Error, c: Context) {\n    return ${branch};\n  },\n};`,
    ],
  ],
  ([form, handlers]) =>
    test(`an app.onError handler held in an object as ${form} documents its branch for the class a route throws`, async () => {
      const document =
        await documented(`import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class LlmError extends Error {}
/** @openapi listProviderModels */
app.get('/providers/models', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError('The provider did not answer');
  }
  return c.json({ models: ['a'] });
});
${handlers}
app.onError(handlers.handleError);
`);

      const responses = document.paths['/providers/models'].get.responses;
      assert.deepStrictEqual(
        Object.keys(resolvedBody(document, responses, '502')?.properties ?? {}),
        ['error'],
        'the route documents the 502 the held handler sends for its LlmError',
      );
    }),
);

test("validate()'s 400 and 415 document the body app.onError sends for each HTTPException validate() throws, with that throw's message as a const", async () => {
  // validate() throws HTTPException (validator.ts:160, 180, 221, 263-272, 290, 306, 316) and
  // never responds itself, so the app's onError writes the 400 and 415 bodies.
  const document = await documented(`import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ problem: error.message }, error.status);
  }
  return c.json({ problem: 'internal' }, 500);
});
/** @openapi createItem */
app.post('/items', validate('application/json', (payload) => ({
  name: { select: payload.body.name, against: z.string() },
})), (c) => c.json({ ok: true }));
`);

  const responses = document.paths['/items'].post.responses;
  for (const [status, messages] of [
    ['400', ['Invalid JSON body', 'Invalid request body', 'Validation failed']],
    ['415', ['Unsupported Media Type']],
  ] as const) {
    assert.deepStrictEqual(bodyOf(responses, status), {
      $ref: `#/components/schemas/validate${status}_application_json`,
    });
    const bodies = bodiesOf(document, responses, status);
    assert.deepStrictEqual(
      bodies.map((body) => Object.keys(body.properties)),
      bodies.map(() => ['problem']),
      `each ${status} is the body app.onError sends`,
    );
    assert.deepStrictEqual(
      bodies.flatMap((body) => body.properties.problem.enum).sort(),
      messages,
      `each ${status} body carries the message of the throw it answers`,
    );
  }
});

test("an evlog catalog throw documents app.onError's EvlogError branch at the catalog entry's status, not evlog's own JSON", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { defineErrorCatalog, EvlogError } from 'evlog';
import { validate } from '@sdk-it/hono/runtime';
const billingErrors = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: { status: 402, message: 'Card declined', why: 'The issuer refused the charge' },
});
export const app = new Hono();
/** @openapi pay */
app.post('/pay', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw billingErrors.PAYMENT_DECLINED();
  }
  return c.json({ ok: true });
});
app.onError((error, c) => {
  if (error instanceof EvlogError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return c.json({ error: { code: 'internal', message: 'Internal Server Error' } }, 500);
});
`);

  const responses = document.paths['/pay'].post.responses;
  const body = resolvedBody(document, responses, '402');
  assert.ok(body, 'the 402 the catalog entry gives is documented');
  assert.deepStrictEqual(Object.keys(body.properties), ['error']);
  assert.deepStrictEqual(body.properties.error.properties, {
    code: { enum: ['billing.PAYMENT_DECLINED'], type: 'string' },
    message: { enum: ['Card declined'], type: 'string' },
  });
});

const evlogCatalog = `import { defineErrorCatalog } from 'evlog';
export const billingErrors = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: { status: 402, message: 'Card declined' },
});
`;

/** Requests `path` from the app in `route.ts`, then analyzes it, with no app.onError. */
async function sentAndDocumented(
  route: string,
  path: string,
  files: Record<string, string> = {},
) {
  await using workspace = await analysisWorkspace('unhandled-errors-', {
    'route.ts': route,
    ...files,
  });
  const { app }: { app: Hono } = await import(
    pathToFileURL(join(workspace.path, 'route.ts')).href
  );
  const response = await app.request(path);
  const sent = {
    status: response.status,
    mediaType: response.headers.get('content-type')?.split(';')[0],
    body: await response.text(),
  };
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths } = await analyze(project, { responseAnalyzer });
  return {
    sent,
    responses: JSON.parse(JSON.stringify(paths))[path].get.responses,
  };
}

test("an HTTPException thrown in an app with no app.onError documents Hono's default: its message as text/plain at its status", async () => {
  const { sent, responses } = await sentAndDocumented(
    `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getItem */
app.get('/item', validate(() => ({})), () => {
  throw new HTTPException(422, { message: 'Bad id' });
});
`,
    '/item',
  );

  assert.deepStrictEqual(sent, {
    status: 422,
    mediaType: 'text/plain',
    body: 'Bad id',
  });
  assert.deepStrictEqual(responses['422'].content, {
    'text/plain': { schema: { type: 'string', enum: ['Bad id'] } },
  });
});

test('an HTTPException whose status is not one literal, thrown in an app with no app.onError, fails analyze naming the throw', async () => {
  await assert.rejects(
    documented(`import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
function refuse(code: 400 | 404): never {
  throw new HTTPException(code, { message: 'Refused' });
}
/** @openapi getItem */
app.get('/item', validate(() => ({})), () => refuse(404));
`),
    /Hono's default error handler sends the HTTPException thrown at \S*route\.ts:6:\d+/,
  );
});

test("an error that is no HTTPException, thrown in an app with no app.onError, documents Hono's default 500 text/plain", async () => {
  const { sent, responses } = await sentAndDocumented(
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
class QuotaError extends Error {}
export const app = new Hono();
/** @openapi getQuota */
app.get('/quota', validate(() => ({})), () => {
  throw new QuotaError('x');
});
`,
    '/quota',
  );

  assert.deepStrictEqual(sent, {
    status: 500,
    mediaType: 'text/plain',
    body: 'Internal Server Error',
  });
  assert.deepStrictEqual(responses['500'].content, {
    'text/plain': {
      schema: { type: 'string', enum: ['Internal Server Error'] },
    },
  });
});

test("an evlog catalog throw in an app with no app.onError documents Hono's default 500 text/plain, not the catalog entry's status", async () => {
  const { sent, responses } = await sentAndDocumented(
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { billingErrors } from './catalog.ts';
export const app = new Hono();
/** @openapi pay */
app.get('/pay', validate(() => ({})), () => {
  throw billingErrors.PAYMENT_DECLINED();
});
`,
    '/pay',
    { 'catalog.ts': evlogCatalog },
  );

  assert.deepStrictEqual(sent, {
    status: 500,
    mediaType: 'text/plain',
    body: 'Internal Server Error',
  });
  assert.equal(
    responses['402'],
    undefined,
    'Hono never sends the entry status',
  );
  assert.deepStrictEqual(responses['500'].content, {
    'text/plain': {
      schema: { type: 'string', enum: ['Internal Server Error'] },
    },
  });
});

const clinicalRefusals = `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
type RefusalCode = 'patient_not_found' | 'reading_out_of_range' | 'already_booked';
const refusalMessage: Record<RefusalCode, string> = {
  patient_not_found: 'This patient does not exist.',
  reading_out_of_range: 'The reading is out of range.',
  already_booked: 'The slot is already booked.',
};
const refusalStatus = {
  patient_not_found: 404,
  reading_out_of_range: 400,
  already_booked: 409,
} as const satisfies Record<RefusalCode, 400 | 404 | 409>;
class ClinicalRefusal extends Error {
  readonly code: RefusalCode;
  constructor(code: RefusalCode, options?: ErrorOptions) {
    super(refusalMessage[code], options);
    this.code = code;
  }
}
class ReadingRefused extends ClinicalRefusal {
  constructor(readonly problems: string[]) {
    super('reading_out_of_range');
  }
}
/** @openapi getPatient */
app.get('/patients', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new ClinicalRefusal('patient_not_found');
  }
  return c.json({ id: 'p1' });
});
/** @openapi recordReading */
app.post('/readings', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new ReadingRefused(['systolic above 300']);
  }
  return c.json({ id: 'r1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof ClinicalRefusal) {
    BODY
  }
  return c.json({ error: 'internal' }, 500);
});
`;

test("an error class whose constructor assigns its code from a parameter documents each throw at the status its code reads from an as-const table, through a subclass's super call", async () => {
  const document = await documented(
    clinicalRefusals.replace(
      'BODY',
      'return c.json({ error: error.message }, refusalStatus[error.code]);',
    ),
  );

  const patient = document.paths['/patients'].get.responses;
  const reading = document.paths['/readings'].post.responses;
  assert.ok(bodyOf(patient, '404'), "getPatient's ClinicalRefusal is a 404");
  assert.deepStrictEqual(
    [patient['400'], patient['409']],
    [undefined, undefined],
    'getPatient throws no other refusal code',
  );
  assert.ok(
    bodyOf(reading, '400'),
    "recordReading's ReadingRefused passes reading_out_of_range to super, a 400",
  );
  assert.deepStrictEqual(
    [reading['404'], reading['409']],
    [undefined, undefined],
    'recordReading throws no other refusal code',
  );
});

test("an error class's code that its constructor assigns from a parameter documents as each throw site's const, one app.onError body per throw, with a guarded spread's property only for the subclass", async () => {
  const document = await documented(
    clinicalRefusals.replace(
      'BODY',
      `return c.json(
      {
        error: error.message,
        cause: {
          code: error.code,
          ...((error instanceof ReadingRefused) && { problems: error.problems }),
        },
      },
      422,
    );`,
    ),
  );

  const causeOf = (responses: any) => {
    const body = resolvedBody(document, responses, '422');
    assert.equal(body.oneOf, undefined, 'each route throws one refusal code');
    return body.properties.cause;
  };
  const patient = causeOf(document.paths['/patients'].get.responses);
  const reading = causeOf(document.paths['/readings'].post.responses);
  assert.deepStrictEqual(patient.properties.code, {
    type: 'string',
    enum: ['patient_not_found'],
  });
  assert.equal(patient.properties.problems, undefined);
  assert.deepStrictEqual(reading.properties.code, {
    type: 'string',
    enum: ['reading_out_of_range'],
  });
  assert.ok(
    reading.properties.problems,
    "ReadingRefused's problems parameter property is in its cause",
  );
});

test("a parameter property documents the argument its throw gives, a missing argument its parameter's initializer, and a mutable field its initializer's literal", async () => {
  const document = await documented(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class QuotaError extends Error {
  kind = 'quota/exceeded';
  constructor(
    readonly plan: 'free' | 'pro',
    readonly retryAfter = 60,
  ) {
    super('Quota exceeded');
  }
}
/** @openapi getQuota */
app.get('/quota', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new QuotaError('free');
  }
  return c.json({ left: 1 });
});
app.onError((error, c) => {
  if (error instanceof QuotaError) {
    return c.json(
      { kind: error.kind, plan: error.plan, retryAfter: error.retryAfter },
      429,
    );
  }
  return c.json({ error: 'internal' }, 500);
});
`);

  const body = resolvedBody(
    document,
    document.paths['/quota'].get.responses,
    '429',
  );
  assert.equal(body.oneOf, undefined, 'the route throws the free plan alone');
  assert.deepStrictEqual(body.properties.plan, {
    type: 'string',
    enum: ['free'],
  });
  assert.deepStrictEqual(body.properties.retryAfter, {
    type: 'number',
    enum: [60],
  });
  assert.deepStrictEqual(body.properties.kind, {
    type: 'string',
    enum: ['quota/exceeded'],
  });
});

test('an error class in another module that copies its status and code from an options object documents the throw at that status with its code and message as consts', async () => {
  const document = await documented(
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { LlmError } from './errors.ts';
export const app = new Hono();
/** @openapi listProviderModels */
app.get('/providers/models', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new LlmError({
      code: 'llm/unavailable',
      message: 'The provider did not answer',
      httpStatus: 502,
    });
  }
  return c.json({ models: ['a'] });
});
app.onError((error, c) => {
  if (error instanceof LlmError) {
    return c.json(
      { error: error.message, cause: { code: error.code } },
      error.httpStatus,
    );
  }
  return c.json({ error: 'internal' }, 500);
});
`,
    {
      'errors.ts': `export class LlmError extends Error {
  readonly code: string;
  readonly httpStatus: 400 | 502;
  constructor(options: { code: string; message: string; httpStatus: 400 | 502 }) {
    super(options.message);
    this.code = options.code;
    this.httpStatus = options.httpStatus;
  }
}
`,
    },
  );

  const responses = document.paths['/providers/models'].get.responses;
  assert.equal(responses['400'], undefined, 'the throw gives 502, not 400');
  const body = resolvedBody(document, responses, '502');
  assert.deepStrictEqual(body.properties.error, {
    type: 'string',
    enum: ['The provider did not answer'],
  });
  assert.deepStrictEqual(body.properties.cause.properties.code, {
    type: 'string',
    enum: ['llm/unavailable'],
  });
});

test("a thrown call to a function that returns an HTTPException documents Hono's default at the status the call passes", async () => {
  const { sent, responses } = await sentAndDocumented(
    `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
function refusal(status: ContentfulStatusCode, message = 'Already booked') {
  return new HTTPException(status, { message });
}
/** @openapi getBooking */
app.get('/booking', validate(() => ({})), () => {
  throw refusal(409);
});
`,
    '/booking',
  );

  assert.deepStrictEqual(sent, {
    status: 409,
    mediaType: 'text/plain',
    body: 'Already booked',
  });
  assert.deepStrictEqual(responses['409'].content, {
    'text/plain': { schema: { type: 'string', enum: ['Already booked'] } },
  });
});

void test.each(
  [
    [
      'with no constructor of its own',
      'class Conflict extends HTTPException {}',
      "new Conflict(409, { message: 'b1' })",
    ],
    [
      'whose constructor passes a status to super',
      'class Conflict extends HTTPException {\n  constructor(id: string) {\n    super(409, { message: id });\n  }\n}',
      "new Conflict('b1')",
    ],
  ],
  ([shape, declaration, construction]) =>
    test(`a thrown subclass of HTTPException ${shape} documents Hono's default at the status its construction gives HTTPException`, async () => {
      const { sent, responses } = await sentAndDocumented(
        `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
${declaration}
/** @openapi getBooking */
app.get('/booking', validate(() => ({})), () => {
  throw ${construction};
});
`,
        '/booking',
      );

      assert.deepStrictEqual(sent, {
        status: 409,
        mediaType: 'text/plain',
        body: 'b1',
      });
      assert.deepStrictEqual(responses['409'].content, {
        'text/plain': { schema: { type: 'string', enum: ['b1'] } },
      });
    }),
);

test("an HTTPException thrown with no message documents Hono's default body as the empty text it sends", async () => {
  const { sent, responses } = await sentAndDocumented(
    `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getItem */
app.get('/item', validate(() => ({})), () => {
  throw new HTTPException(404);
});
`,
    '/item',
  );

  assert.deepStrictEqual(sent, {
    status: 404,
    mediaType: 'text/plain',
    body: '',
  });
  assert.deepStrictEqual(responses['404'].content, {
    'text/plain': { schema: { type: 'string', enum: [''] } },
  });
});

const refusalsWithLocalCause = (
  declaration: 'const' | 'let',
) => `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono<{
  Variables: { log?: { warn(message: string, fields: object): void } };
}>();
type RefusalCode = 'patient_not_found' | 'reading_refused' | 'intake_refused' | 'already_booked';
const refusalMessage: Record<RefusalCode, string> = {
  patient_not_found: 'This patient does not exist.',
  reading_refused: 'The reading is refused.',
  intake_refused: 'The intake is refused.',
  already_booked: 'The slot is already booked.',
};
const refusalStatus = {
  patient_not_found: 404,
  reading_refused: 400,
  intake_refused: 400,
  already_booked: 409,
} as const satisfies Record<RefusalCode, 400 | 404 | 409>;
class ClinicalRefusal extends Error {
  readonly code: RefusalCode;
  constructor(code: RefusalCode, options?: ErrorOptions) {
    super(refusalMessage[code], options);
    this.name = 'ClinicalRefusal';
    this.code = code;
  }
}
class ReadingRefused extends ClinicalRefusal {
  readonly problems: string[];
  constructor(problems: string[]) {
    super('reading_refused');
    this.name = 'ReadingRefused';
    this.problems = problems;
  }
}
class IntakeRefused extends ClinicalRefusal {
  readonly problems: { at: string; refusal: RefusalCode }[];
  constructor(problems: { at: string; refusal: RefusalCode }[], options?: ErrorOptions) {
    super('intake_refused', options);
    this.name = 'IntakeRefused';
    this.problems = problems;
  }
}
/** @openapi getPatient */
app.get('/patients', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new ClinicalRefusal('patient_not_found');
  }
  return c.json({ id: 'p1' });
});
/** @openapi recordReading */
app.post('/readings', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new ReadingRefused(['systolic above 300']);
  }
  return c.json({ id: 'r1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof ClinicalRefusal) {
    ${declaration} cause = {
      code: error.code,
      detail: error.message,
      ...((error instanceof ReadingRefused ||
        error instanceof IntakeRefused) && { problems: error.problems }),
    };
    c.get('log')?.warn(error.message, { cause });
    return c.json({ error: error.message, cause }, refusalStatus[error.code]);
  }
  return c.json({ error: 'internal' }, 500);
});
`;

test("a const that app.onError's branch declares from the error is documented per throw site, so a refusal's cause has its own code and only a subclass that carries problems documents them", async () => {
  const document = await documented(refusalsWithLocalCause('const'));

  const patient = document.paths['/patients'].get.responses;
  const reading = document.paths['/readings'].post.responses;
  assert.deepStrictEqual(
    [patient['400'], patient['409'], reading['404'], reading['409']],
    [undefined, undefined, undefined, undefined],
    'each route documents the one status its refusal code reads',
  );
  const patientBody = resolvedBody(document, patient, '404');
  const readingBody = resolvedBody(document, reading, '400');
  assert.equal(patientBody.oneOf, undefined, 'getPatient throws one code');
  assert.equal(readingBody.oneOf, undefined, 'recordReading throws one code');
  const patientCause = patientBody.properties.cause;
  const readingCause = readingBody.properties.cause;
  assert.deepStrictEqual(patientCause.properties.code, {
    type: 'string',
    enum: ['patient_not_found'],
  });
  assert.deepStrictEqual(readingCause.properties.code, {
    type: 'string',
    enum: ['reading_refused'],
  });
  assert.deepStrictEqual(
    patientCause.properties.detail,
    { type: 'string' },
    'the message is refusalMessage[code], a Record of strings',
  );
  assert.equal(
    patientCause.properties.problems,
    undefined,
    'a plain ClinicalRefusal never sends problems',
  );
  assert.deepStrictEqual(patientCause.required.toSorted(), ['code', 'detail']);
  assert.deepStrictEqual(readingCause.properties.problems, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepStrictEqual(readingCause.required.toSorted(), [
    'code',
    'detail',
    'problems',
  ]);
});

test("a let that app.onError's branch declares from the error is documented by its type, since a let can be reassigned before it is sent", async () => {
  const document = await documented(refusalsWithLocalCause('let'));

  const patient = document.paths['/patients'].get.responses;
  const patientCause = resolvedBody(document, patient, '404').properties.cause;
  assert.deepStrictEqual(
    patientCause.properties.code,
    {
      anyOf: [
        { type: 'string', enum: ['already_booked'] },
        { type: 'string', enum: ['intake_refused'] },
        { type: 'string', enum: ['patient_not_found'] },
        { type: 'string', enum: ['reading_refused'] },
      ],
    },
    "the let's code is every RefusalCode",
  );
  assert.ok(
    patientCause.properties.problems,
    "the let's type has the problems its spread may add",
  );
});

const refusalOf = (body: string) => `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class Refusal extends Error {
  readonly code: 'slot_taken' | 'slot_closed';
  constructor(code: 'slot_taken' | 'slot_closed') {
    super('The slot is refused.');
    this.code = code;
  }
}
/** @openapi bookSlot */
app.post('/slots', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw new Refusal(Math.random() > 0.5 ? 'slot_taken' : 'slot_closed');
  }
  return c.json({ id: 's1' }, 201);
});
app.onError((error, c) => {
  if (error instanceof Refusal) {
    ${body}
  }
  return c.json({ error: 'internal' }, 500);
});
`;

test('a code that app.onError reads only through a const that another const names documents one body for each code the throw may give, as the same read written in place does', async () => {
  const document = await documented(
    refusalOf(`const code = error.code;
    const cause = { code };
    return c.json({ cause }, 409);`),
  );

  const body = bodyOf(document.paths['/slots'].post.responses, '409');
  assert.deepStrictEqual(
    body.oneOf.map((branch: any) => branch.properties.cause.properties.code),
    [
      { type: 'string', enum: ['slot_closed'] },
      { type: 'string', enum: ['slot_taken'] },
    ],
  );
});

test("a const that app.onError's branch declares from the error and names inside its own initializer documents one body for each code, its own name read by its type", async () => {
  const document = await documented(
    refusalOf(`const cause = { retry: () => cause, code: error.code };
    return c.json({ cause }, 409);`),
  );

  const body = bodyOf(document.paths['/slots'].post.responses, '409');
  assert.deepStrictEqual(
    body.oneOf.map((branch: any) => branch.properties.cause),
    ['slot_closed', 'slot_taken'].map((code) => ({
      type: 'object',
      properties: { code: { type: 'string', enum: [code] } },
      required: ['code'],
      additionalProperties: false,
    })),
    'the function has no JSON form, so retry is left out',
  );
});

void test.each(
  [
    [
      'as a property value',
      'return c.json({ cause: cause }, 409);',
      (branch: any) => branch.properties.cause,
    ],
    [
      'as the whole body',
      'return c.json(cause, 409);',
      (branch: any) => branch,
    ],
    [
      'as a spread',
      'return c.json({ ...cause }, 409);',
      (branch: any) => branch,
    ],
  ] as const,
  ([form, body, causeOf]) =>
    test(`a const that app.onError's branch declares from the error and sends ${form} documents one body for each code the throw may give`, async () => {
      const document = await documented(
        refusalOf(`const cause = { code: error.code };
    ${body}`),
      );

      const sent = bodyOf(document.paths['/slots'].post.responses, '409');
      assert.deepStrictEqual(
        sent.oneOf.map((branch: any) => causeOf(branch).properties.code),
        [
          { type: 'string', enum: ['slot_closed'] },
          { type: 'string', enum: ['slot_taken'] },
        ],
      );
    }),
);

/** A route that throws `thrown`, under an app.onError that sends the error itself as the cause of its 500, as deepagents' evals-web-runner does. */
function sendsErrorAsCause(thrown: string) {
  return `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
class QuotaError extends Error {
  readonly plan = 'free';
}
const marker = Symbol('MarkedError');
class MarkedError extends Error {
  readonly plan = 'pro';
  [marker]: true;
  constructor(message: string) {
    super(message);
    this[marker] = true;
  }
}
/** @openapi getQuota */
app.get('/quota', validate(() => ({})), (c) => {
  if (Math.random() > 0.5) {
    throw ${thrown};
  }
  return c.json({ used: 1 });
});
app.onError((error, c) => {
  return c.json({ error: 'Internal Server Error', cause: error }, 500);
});
`;
}

/** The schema of the cause the route's own throw sends in its 500, through a `$ref` into components. */
function routeCause(document: { paths: any; components: any }) {
  const route = bodyOf(
    document.paths['/quota'].get.responses,
    '500',
  ).oneOf.find(
    (branch: any) =>
      branch.$ref !== '#/components/schemas/validate500_application_json',
  );
  const cause = route.properties.cause;
  return cause.$ref
    ? document.components.schemas[
        cause.$ref.replace('#/components/schemas/', '')
      ]
    : cause;
}

test("an Error that app.onError sends as a member documents the empty object JSON.stringify writes for it, since Error's name, message, stack and cause are not enumerable", async () => {
  const document = await documented(sendsErrorAsCause("new Error('x')"));

  assert.deepStrictEqual(routeCause(document), {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  });
});

test("an Error subclass that app.onError sends as a member documents the subclass's own fields and none of Error's", async () => {
  const document = await documented(
    sendsErrorAsCause("new QuotaError('Over quota')"),
  );

  assert.deepStrictEqual(routeCause(document), {
    type: 'object',
    properties: { plan: { type: 'string', enum: ['free'] } },
    required: ['plan'],
    additionalProperties: false,
  });
});

test('an error class field keyed by a symbol is not documented when app.onError sends the error, since JSON.stringify skips symbol keys', async () => {
  const document = await documented(
    sendsErrorAsCause("new MarkedError('Marked')"),
  );

  assert.deepStrictEqual(routeCause(document), {
    type: 'object',
    properties: { plan: { type: 'string', enum: ['pro'] } },
    required: ['plan'],
    additionalProperties: false,
  });
});
