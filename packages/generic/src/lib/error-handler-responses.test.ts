import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

/** Analyzes `route.ts` and returns the document as consumers write it to openapi.json. */
async function documented(route: string) {
  await using workspace = await analysisWorkspace('error-handler-responses-', {
    'route.ts': route,
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

for (const [reads, body] of [
  ['', '{ error: error.message }'],
  [
    ', also when the body reads the status',
    '{ error: error.message, status: error.status }',
  ],
]) {
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
  });
}

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

for (const [form, handlers] of [
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
]) {
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
  });
}
