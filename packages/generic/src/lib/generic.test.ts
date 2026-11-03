import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  type ReferenceObject,
  type SchemaObject,
  isReferenceObject,
  isSchemaObject,
} from 'openapi3-ts/oas31';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analysisWorkspace } from '@sdk-it/testing';

import { analyze } from './generic.ts';
import { responseAnalyzer } from './response-analyzer.ts';

function getNonNullBranch(schema: any) {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.find((candidate: any) => candidate.type !== 'null');
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.find((candidate: any) => candidate.type !== 'null');
  }
  return schema;
}

const uiMessageSource = `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import type { UIMessage } from 'ai';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

const emptyMessages: UIMessage[] = [];

/** @openapi firstMessages */
app.get('/first', validate(() => ({})), () => {
  return output.json({ messages: emptyMessages, usage: null });
});

/** @openapi secondMessages */
app.get('/second', validate(() => ({})), () => {
  return output.json({ messages: emptyMessages, usage: null });
});
`;

async function analyzeUIMessage() {
  await using workspace = await analysisWorkspace('generic-', {
    'index.ts': uiMessageSource,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  return await analyze(project, { responseAnalyzer });
}

describe('analyze function tests', () => {
  it('should parse basic validation middleware with selectors', async () => {
    // Test Case 1: Basic validation middleware with query and body selectors
    await using workspace = await analysisWorkspace('generic-', {
      'test1.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

/**
 * @openapi getUserProfile
 * @tags user
 * @description Get user profile information
 */
app.post('/users/:id/profile', validate((payload) => ({
  userId: { select: payload.params.id, against: z.string() },
  name: { select: payload.body.name, against: z.string() },
  email: { select: payload.query.email, against: z.string().email().optional() }
})), (c) => {
  return output.json({ success: true, user: c.get('input') });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result1 = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    assert.strictEqual(
      Object.keys(result1.paths).length,
      1,
      'Should have one path',
    );
    assert.ok(
      '/users/{id}/profile' in result1.paths,
      'Should have user profile path',
    );
    assert.strictEqual(
      result1.paths['/users/{id}/profile']?.post?.operationId,
      'getUserProfile',
      'Should have correct operation ID',
    );
    assert.ok(result1.tags.includes('user'), 'Should include user tag');
    const {
      paths,
    }: {
      paths: Record<
        string,
        {
          post: {
            parameters: { in: string; name: string; required: boolean }[];
            requestBody: {
              content: Record<string, { schema: { properties: unknown } }>;
            };
          };
        }
      >;
    } = JSON.parse(JSON.stringify(result1));
    const profile = paths['/users/{id}/profile'].post;
    assert.deepStrictEqual(
      profile.parameters.map(({ in: location, name, required }) => [
        location,
        name,
        required,
      ]),
      [
        ['path', 'id', true],
        ['query', 'email', false],
      ],
    );
    assert.deepStrictEqual(
      profile.requestBody.content['application/json'].schema.properties,
      { name: { type: 'string' } },
    );
  });

  it('should handle error responses with ProblemDetailsException', async () => {
    // Test Case 2: Error response handling with ProblemDetailsException
    await using workspace = await analysisWorkspace('generic-', {
      'test2.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

class ProblemDetailsException extends Error {
  constructor(readonly problem: { status: string; title: string; detail: string }) {
    super(problem.title);
  }
}

/**
 * @openapi getResource
 * @summary Get a resource that might not exist
 */
app.get('/resource/:id', validate((payload) => ({
  id: { select: payload.params.id, against: z.string() }
})), (c) => {
  const id = c.get('input').id;
  if (id === 'notfound') {
    throw new ProblemDetailsException({
      status: '404',
      title: 'Resource not found',
      detail: 'The requested resource does not exist'
    });
  }
  return output.json({ id, data: 'some data' });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result2 = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    assert.strictEqual(
      Object.keys(result2.paths).length,
      1,
      'Should have one path',
    );
    assert.ok(
      result2.paths['/resource/{id}']?.get?.responses?.['404'] !== undefined,
      'Should have 404 error response',
    );
    assert.ok(
      result2.paths['/resource/{id}']?.get?.responses?.['200'] !== undefined,
      'Should have 200 success response',
    );
  });

  it('should handle multiple HTTP methods and content types', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

/**
 * @openapi listItems
 * @tags items
 */
app.get('/items', validate((payload) => ({
  pageSize: {
    select: payload.query.pageSize,
		against: z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(50)
  .nullish()
  .transform((value) => (value === null || value === undefined ? 50 : value))
  },
  pageNo: {
    select: payload.query.pageNo,
    against: z.string().optional()
  }
})), (c) => {
  return c.json({ items: [], total: 0 });
});

`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    assert.strictEqual(
      Object.keys(result.paths).length,
      1,
      'Should have one path',
    );
  });

  it('should analyze responses from all middlewares', async () => {
    // Test Case 4: Middleware analysis with authenticate and ratelimit
    await using workspace = await analysisWorkspace('generic-', {
      'test4.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

const authenticate = (): MiddlewareHandler => async (c, next) => {
  const token = c.req.header('Authorization');
  if (!token) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  await next();
};

const ratelimit = (): MiddlewareHandler => async (c, next) => {
  const limit = c.req.header('X-RateLimit-Remaining');
  if (limit === '0') {
    throw new HTTPException(429, { message: 'Too many requests' });
  }
  await next();
};

const earlyReturn = (): MiddlewareHandler => async (c, next) => {
  if (c.req.query('skip') === 'true') {
    return output.json({ skipped: true }, 202);
  }
  await next();
};

/**
 * @openapi createVendor
 * @tags vendors
 * @description Create a new vendor account.
 */
app.post(
  '/vendor',
  ratelimit(),
  authenticate(),
  earlyReturn(),
  validate((payload) => ({
    id: { select: payload.body.id, against: z.string().min(1) },
    email: { select: payload.body.email, against: z.string().email() },
    name: { select: payload.body.name, against: z.string().min(1) }
  })),
  (c) => {
    return output.json({ success: true, vendor: c.get('input') });
  }
);
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    assert.strictEqual(
      Object.keys(result.paths).length,
      1,
      'Should have one path',
    );

    const vendorPath = result.paths['/vendor']?.post;
    assert.ok(vendorPath, 'Should have vendor POST endpoint');
    // Should have responses from all middlewares
    assert.ok(
      vendorPath.responses?.['202'] !== undefined,
      'Should have 202 response from earlyReturn middleware',
    );
    assert.ok(
      vendorPath.responses?.['200'] !== undefined,
      'Should have 200 response from main handler',
    );
  });

  it('derives effective operation security from resolved middleware symbols', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'auth.ts': `
import type { MiddlewareHandler } from 'hono';

export const authenticate = (): MiddlewareHandler => async (_c, next) => {
  await next();
};
`,
      'routes.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { authenticate as requireAuth } from './auth.js';

const app = new Hono();

/** @openapi getAccount */
app.get(
  '/account',
  requireAuth(),
  validate(() => ({})),
  (c) => c.json({ ok: true }),
);

/** @openapi getStatus */
app.get('/status', validate(() => ({})), (c) => c.json({ ok: true }));
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer,
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
      },
      middlewareSecurity: [
        {
          middleware: {
            import: 'authenticate',
            from: join(workspace.path, 'auth.ts'),
          },
          security: [{ bearer: [] }],
        },
      ],
    });

    assert.deepStrictEqual(result.components.securitySchemes, {
      bearer: { type: 'http', scheme: 'bearer' },
    });
    assert.deepStrictEqual(result.paths['/account']?.get?.security, [
      { bearer: [] },
    ]);
    assert.deepStrictEqual(result.paths['/status']?.get?.security, []);
  });

  it('derives security from middleware passed by reference rather than called', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'auth.ts': `
import type { MiddlewareHandler } from 'hono';

export const authenticate: MiddlewareHandler = async (_c, next) => {
  await next();
};
`,
      'routes.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { authenticate } from './auth.js';

const app = new Hono();

/** @openapi getAccount */
app.get('/account', authenticate, validate(() => ({})), (c) => c.json({ ok: true }));
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer,
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
      },
      middlewareSecurity: [
        {
          middleware: {
            import: 'authenticate',
            from: join(workspace.path, 'auth.ts'),
          },
          security: [{ bearer: [] }],
        },
      ],
    });

    assert.deepStrictEqual(result.paths['/account']?.get?.security, [
      { bearer: [] },
    ]);
  });

  it('resolves a constant referenced more than once in one expression', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'auth.ts': `
import type { MiddlewareHandler } from 'hono';

export const authorise =
  (_roles: readonly string[]): MiddlewareHandler =>
  async (_c, next) => {
    await next();
  };
`,
      'routes.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { authorise } from './auth.js';

const app = new Hono();
const ADMIN = 'admin';
const ROUTE_ROLES = [ADMIN, 'doctor'] as const;

/** @openapi getCases */
app.get(
  '/cases',
  authorise([ADMIN, ...ROUTE_ROLES]),
  validate(() => ({})),
  (c) => c.json({ ok: true }),
);
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer,
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
      },
      middlewareSecurity: [
        {
          middleware: {
            import: 'authorise',
            from: join(workspace.path, 'auth.ts'),
          },
          security: [{ bearer: [] }],
          values: { scheme: 'bearer', argument: 0, mode: 'any' },
        },
      ],
    });

    assert.deepStrictEqual(result.paths['/cases']?.get?.security, [
      { bearer: ['admin'] },
      { bearer: ['doctor'] },
    ]);
  });

  it('combines middleware security and resolves any-role constants', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'auth.ts': `
import type { MiddlewareHandler } from 'hono';

export const authenticate = (): MiddlewareHandler => async (_c, next) => {
  await next();
};
export const authorise =
  (_roles: readonly string[]): MiddlewareHandler =>
  async (_c, next) => {
    await next();
  };
`,
      'roles.ts': `
export enum Role {
  Doctor = 'doctor',
  Coordinator = 'coordinator',
}

export const CARE_ROLES = [Role.Doctor, Role.Coordinator] as const;
`,
      'routes.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { authenticate, authorise as allowRoles } from './auth.js';
import { CARE_ROLES } from './roles.js';

const app = new Hono();
const ADMIN = 'admin';
const ROUTE_ROLES = [...CARE_ROLES, ADMIN] as const;

/** @openapi getCases */
app.get(
  '/cases',
  authenticate(),
  allowRoles([...ROUTE_ROLES]),
  validate(() => ({})),
  (c) => c.json({ ok: true }),
);
`,
    });
    const authModule = join(workspace.path, 'auth.ts');

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer,
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
      },
      middlewareSecurity: [
        {
          middleware: { import: 'authenticate', from: authModule },
          security: [{ bearer: [] }],
        },
        {
          middleware: { import: 'authorise', from: authModule },
          security: [{ bearer: [] }],
          values: { scheme: 'bearer', argument: 0, mode: 'any' },
        },
      ],
    });

    assert.deepStrictEqual(result.paths['/cases']?.get?.security, [
      { bearer: ['doctor'] },
      { bearer: ['coordinator'] },
      { bearer: ['admin'] },
    ]);
  });

  it('combines schemes with AND and keeps all required values together', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'auth.ts': `
import type { MiddlewareHandler } from 'hono';

export const authorise =
  (_roles: readonly string[]): MiddlewareHandler =>
  async (_c, next) => {
    await next();
  };
export const requireTenant = (): MiddlewareHandler => async (_c, next) => {
  await next();
};
`,
      'routes.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { authorise, requireTenant } from './auth.js';

const app = new Hono();
const ROLES = ['doctor', 'coordinator'] as const;

/** @openapi getCases */
app.get(
  '/cases',
  authorise(ROLES),
  requireTenant(),
  validate(() => ({})),
  (c) => c.json({ ok: true }),
);
`,
    });
    const authModule = join(workspace.path, 'auth.ts');

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer,
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
        tenantKey: { type: 'apiKey', in: 'header', name: 'X-Tenant-Key' },
      },
      middlewareSecurity: [
        {
          middleware: { import: 'authorise', from: authModule },
          security: [{ bearer: [] }],
          values: { scheme: 'bearer', argument: 0, mode: 'all' },
        },
        {
          middleware: { import: 'requireTenant', from: authModule },
          security: [{ tenantKey: [] }],
        },
      ],
    });

    assert.deepStrictEqual(result.paths['/cases']?.get?.security, [
      { bearer: ['doctor', 'coordinator'], tenantKey: [] },
    ]);
  });

  it('fails analysis when middleware security values are dynamic', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'auth.ts': `
import type { MiddlewareHandler } from 'hono';

export const authorise =
  (_roles: readonly string[]): MiddlewareHandler =>
  async (_c, next) => {
    await next();
  };
`,
      'routes.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { authorise } from './auth.js';

const app = new Hono();
declare function rolesFromDatabase(): string[];

/** @openapi getCases */
app.get(
  '/cases',
  authorise(rolesFromDatabase()),
  validate(() => ({})),
  (c) => c.json({ ok: true }),
);
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    await assert.rejects(
      analyze(project, {
        responseAnalyzer,
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        middlewareSecurity: [
          {
            middleware: {
              import: 'authorise',
              from: join(workspace.path, 'auth.ts'),
            },
            security: [{ bearer: [] }],
            values: { scheme: 'bearer', argument: 0, mode: 'any' },
          },
        ],
      }),
      /Could not statically resolve security values at/,
    );
  });

  it('should follow call expressions into helper functions', async () => {
    // Test Case 5: Recursive call expression following
    await using workspace = await analysisWorkspace('generic-', {
      'test5.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

// Helper function that throws
function verifyContentType(contentType: string | undefined) {
  if (!contentType) {
    throw new HTTPException(415, {
      message: 'Unsupported Media Type',
      cause: { code: 'api/unsupported-media-type' }
    });
  }
}

// Helper function that calls another helper
function parseJson(c: Context) {
  verifyContentType(c.req.header('content-type'));
  try {
    return c.req.json();
  } catch (error) {
    throw new HTTPException(400, {
      message: 'Invalid JSON',
      cause: { code: 'api/invalid-json' }
    });
  }
}

/**
 * @openapi createItem
 * @tags items
 */
app.post(
  '/items',
  validate((payload) => ({
    name: { select: payload.body.name, against: z.string() }
  })),
  (c) => {
    const data = parseJson(c);
    return output.json({ success: true, item: data });
  }
);
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    assert.strictEqual(
      Object.keys(result.paths).length,
      1,
      'Should have one path',
    );

    const itemPath = result.paths['/items']?.post;
    assert.ok(itemPath, 'Should have item POST endpoint');

    // Should have responses from helper functions
    assert.ok(
      itemPath.responses?.['200'] !== undefined,
      'Should have 200 response from main handler',
    );
  });

  it('should handle zod date and datetime validators', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

/**
 * @openapi createEvent
 * @tags events
 */
app.post('/events', validate((payload) => ({
  scheduledAt: {
    select: payload.body.scheduledAt,
    against: z.string().datetime()
  },
  dateOnly: {
    select: payload.body.dateOnly,
    against: z.string().date()
  },
  nativeDate: {
    select: payload.body.nativeDate,
    against: z.date()
  },
  coercedDate: {
    select: payload.body.coercedDate,
    against: z.coerce.date()
  }
})), (c) => {
  return c.json({ success: true });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    assert.strictEqual(
      Object.keys(result.paths).length,
      1,
      'Should have one path',
    );

    const operation = result.paths['/events']?.post;
    assert.ok(operation, 'Should have POST /events');

    const requestBody = operation.requestBody;
    const body =
      requestBody && 'content' in requestBody
        ? requestBody.content?.['application/json']?.schema
        : undefined;
    assert.ok(body && 'properties' in body, 'Should have request body schema');

    const props = body.properties;
    assert.ok(props, 'Should have properties');

    // z.string().datetime() => { type: "string", format: "date-time" }
    assert.deepStrictEqual(props.scheduledAt, {
      type: 'string',
      format: 'date-time',
    });

    // z.string().date() => { type: "string", format: "date" }
    assert.deepStrictEqual(props.dateOnly, {
      type: 'string',
      format: 'date',
    });

    // z.date() => { type: "string", format: "date-time", "x-zod-type": "date" }
    assert.deepStrictEqual(props.nativeDate, {
      type: 'string',
      format: 'date-time',
      'x-zod-type': 'date',
    });

    // z.coerce.date() => { type: "string", format: "date-time", "x-zod-type": "coerce-date" }
    assert.deepStrictEqual(props.coercedDate, {
      type: 'string',
      format: 'date-time',
      'x-zod-type': 'coerce-date',
    });
  });

  it('should handle optional date validators', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

/**
 * @openapi updateEvent
 * @tags events
 */
app.post('/events/:id', validate((payload) => ({
  id: { select: payload.params.id, against: z.string() },
  scheduledAt: {
    select: payload.body.scheduledAt,
    against: z.date().optional()
  },
  coercedDate: {
    select: payload.body.coercedDate,
    against: z.coerce.date().optional()
  }
})), (c) => {
  return c.json({ success: true });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    const operation = result.paths['/events/{id}']?.post;
    assert.ok(operation, 'Should have POST /events/{id}');

    const requestBody = operation.requestBody;
    const body =
      requestBody && 'content' in requestBody
        ? requestBody.content?.['application/json']?.schema
        : undefined;
    assert.ok(body && 'properties' in body, 'Should have request body schema');

    const props = body.properties;
    assert.ok(props, 'Should have properties');

    // optional z.date() preserves x-zod-type and is not required
    assert.deepStrictEqual(props.scheduledAt, {
      type: 'string',
      format: 'date-time',
      'x-zod-type': 'date',
    });
    assert.ok(
      !(body.required ?? []).includes('scheduledAt'),
      'scheduledAt should not be required',
    );

    // optional z.coerce.date() preserves x-zod-type and is not required
    assert.deepStrictEqual(props.coercedDate, {
      type: 'string',
      format: 'date-time',
      'x-zod-type': 'coerce-date',
    });
    assert.ok(
      !(body.required ?? []).includes('coercedDate'),
      'coercedDate should not be required',
    );
  });

  it('should handle date validators in query params', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

/**
 * @openapi listEvents
 * @tags events
 */
app.get('/events', validate((payload) => ({
  since: {
    select: payload.query.since,
    against: z.string().datetime().optional()
  },
  before: {
    select: payload.query.before,
    against: z.string().date()
  }
})), (c) => {
  return c.json({ items: [] });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    const operation = result.paths['/events']?.get;
    assert.ok(operation, 'Should have GET /events');

    const params = (operation.parameters ?? []).flatMap((parameter) =>
      isReferenceObject(parameter) ? [] : [parameter],
    );
    const since = params.find((p) => p.name === 'since');
    assert.ok(since, 'Should have since parameter');
    assert.equal(since.required, false);
    assert.deepStrictEqual(since.schema, {
      type: 'string',
      format: 'date-time',
    });

    const before = params.find((p) => p.name === 'before');
    assert.ok(before, 'Should have before parameter');
    assert.equal(before.required, true);
    assert.deepStrictEqual(before.schema, {
      type: 'string',
      format: 'date',
    });
  });

  it('should respect depth limits when following call expressions', async () => {
    // Test Case 6: Depth limiting
    await using workspace = await analysisWorkspace('generic-', {
      'test6.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

function level5() {
  throw new HTTPException(503, { message: 'Too deep' });
}

function level4() {
  level5();
}

function level3() {
  level4();
}

function level2() {
  level3();
}

function level1() {
  level2();
}

/**
 * @openapi deepTest
 */
app.get(
  '/deep',
  validate((payload) => ({
    id: { select: payload.query.id, against: z.string() }
  })),
  (c) => {
    level1();
    return output.json({ success: true });
  }
);
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    const deepPath = result.paths['/deep']?.get;
    assert.ok(deepPath, 'Should have deep GET endpoint');

    // With default max depth of 5, should capture the exception at level 5
    // Depth 0: handler -> Depth 1: level1 -> Depth 2: level2 ->
    // Depth 3: level3 -> Depth 4: level4 -> Depth 5: level5
  });

  it('should deduplicate named middleware responses across operations', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'test.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

class ProblemDetailsException extends Error {
  constructor(readonly problem: { status: string; title: string; detail: string }) {
    super(problem.title);
  }
}

const authenticate = (): MiddlewareHandler => async () => {
  throw new ProblemDetailsException({
    status: '401',
    title: 'Unauthorized',
    detail: 'Authentication required'
  });
};

/** @openapi listUsers @tags users */
app.get('/users', authenticate(), validate((p) => ({
  page: { select: p.query.page, against: z.string().optional() }
})), (c) => {
  return output.json({ users: [] });
});

/** @openapi createUser @tags users */
app.post('/users', authenticate(), validate((p) => ({
  name: { select: p.body.name, against: z.string() }
})), (c) => {
  return output.json({ id: 1 });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    // Shared middleware schema should exist once in components
    const sharedKey = 'authenticate401_application_problem+json';
    assert.ok(
      result.components.schemas?.[sharedKey],
      'Should have shared schema for authenticate 401',
    );

    // Both operations should reference the shared schema via $ref
    const listUsers = result.paths['/users']?.get;
    const createUser = result.paths['/users']?.post;
    const listRef =
      listUsers?.responses?.['401']?.content?.['application/problem+json']
        ?.schema;
    const createRef =
      createUser?.responses?.['401']?.content?.['application/problem+json']
        ?.schema;
    assert.deepStrictEqual(listRef, {
      $ref: `#/components/schemas/${sharedKey}`,
    });
    assert.deepStrictEqual(createRef, {
      $ref: `#/components/schemas/${sharedKey}`,
    });
  });

  it('should not deduplicate anonymous middleware responses', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'test.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

/** @openapi getItem @tags items */
app.get('/items/:id',
  validate((p) => ({
    id: { select: p.params.id, against: z.string() }
  })),
  (c) => {
    return output.json({ item: {} });
  }
);

/** @openapi listItems @tags items */
app.get('/items',
  validate((p) => ({
    page: { select: p.query.page, against: z.string().optional() }
  })),
  (c) => {
    return output.json({ items: [] });
  }
);
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    // No shared schemas should exist since there are no named middlewares
    const sharedSchemaKeys = Object.keys(result.components.schemas ?? {});
    assert.ok(
      !sharedSchemaKeys.some((k) => k.includes('401') || k.includes('403')),
      'Should not have any shared middleware schemas',
    );

    // Responses should be inlined, not $ref
    const getItem = result.paths['/items/{id}']?.get;
    const schema200 =
      getItem?.responses?.['200']?.content?.['application/json']?.schema;
    assert.ok(
      schema200 && !('$ref' in schema200),
      '200 response should be inlined',
    );
  });

  it('should preserve integer type for z.number().int() in query and path params', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

/**
 * @openapi getUsers
 * @tags users
 */
app.get('/users', validate((payload) => ({
  page: {
    select: payload.query.page,
    against: z.coerce.number().int().positive().default(1).nullish().transform((v) => v ?? 1),
  },
  limit: {
    select: payload.query.limit,
    against: z.coerce.number().int().min(1).max(1000).default(50).nullish().transform((v) => v ?? 50),
  },
  query: {
    select: payload.query.query,
    against: z.string().optional(),
  },
})), (c) => {
  return c.json({ users: [], pagination: {} });
});

/**
 * @openapi getUserById
 * @tags users
 */
app.get('/users/:userId', validate((payload) => ({
  userId: {
    select: payload.params.userId,
    against: z.coerce.number().int().positive(),
  },
})), (c) => {
  return c.json({ id: 1 });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    // Check getUsers parameters
    const getUsers = result.paths['/users']?.get;
    assert.ok(getUsers, 'Should have GET /users');

    const params = (getUsers.parameters ?? []).flatMap((parameter) =>
      isReferenceObject(parameter) ? [] : [parameter],
    );

    const pageParam = params.find((p) => p.name === 'page');
    assert.ok(pageParam, 'Should have page parameter');

    // The anyOf wrapper from .nullish() should contain type: "integer"
    const pageInnerSchema = getNonNullBranch(pageParam.schema);
    assert.strictEqual(
      pageInnerSchema.type,
      'integer',
      'page parameter should have type "integer" (from .int())',
    );
    assert.strictEqual(
      pageInnerSchema['x-zod-type'],
      'coerce-number',
      'page parameter should preserve x-zod-type on the non-null branch',
    );

    const limitParam = params.find((p) => p.name === 'limit');
    assert.ok(limitParam, 'Should have limit parameter');

    const limitInnerSchema = getNonNullBranch(limitParam.schema);
    assert.strictEqual(
      limitInnerSchema.type,
      'integer',
      'limit parameter should have type "integer" (from .int())',
    );
    assert.strictEqual(
      limitInnerSchema['x-zod-type'],
      'coerce-number',
      'limit parameter should preserve x-zod-type on the non-null branch',
    );

    // Check getUserById path parameter
    const getUserById = result.paths['/users/{userId}']?.get;
    assert.ok(getUserById, 'Should have GET /users/{userId}');

    const byIdParams = (getUserById.parameters ?? []).flatMap((parameter) =>
      isReferenceObject(parameter) ? [] : [parameter],
    );
    const userIdParam = byIdParams.find((p) => p.name === 'userId');
    assert.ok(userIdParam, 'Should have userId parameter');
    const userIdSchema = userIdParam.schema;
    assert.ok(
      userIdSchema && isSchemaObject(userIdSchema),
      'userId parameter should have an inline schema',
    );
    assert.strictEqual(
      userIdSchema.type,
      'integer',
      'userId parameter should have type "integer" (from .int())',
    );
    assert.strictEqual(
      userIdSchema['x-zod-type'],
      'coerce-number',
      'userId parameter should preserve x-zod-type',
    );

    // Full pipeline: analyze → toIR → generateCode → assert .int() in Zod output
    const { toIR } = await import('@sdk-it/spec');
    const { createModelNamer, generateCode } =
      await import('@sdk-it/typescript');

    const spec = {
      openapi: '3.1.0' as const,
      info: { title: 'Test', version: '1.0.0' },
      paths: result.paths,
      components: result.components,
    };

    const ir = await toIR(
      { spec, responses: { flattenErrorResponses: true }, pagination: false },
      false,
    );

    const { groups } = generateCode({
      spec: ir,
      style: { name: 'github' },
      makeImport: (m: string) => m + '.ts',
      modelName: createModelNamer('Client'),
    });

    // Find getUsers schema in generated output
    let getUsersZod = '';
    for (const ops of Object.values(groups)) {
      for (const op of ops) {
        if (op.operationId === 'getUsers') {
          getUsersZod = Object.values(op.schemas)[0] ?? '';
        }
      }
    }

    assert.ok(getUsersZod, 'Should have generated getUsers schema');
    assert.ok(
      getUsersZod.includes("'page': z.coerce.number().int().gt(0)"),
      `Generated getUsers schema should preserve coerce for page but got: ${getUsersZod}`,
    );
    assert.ok(
      getUsersZod.includes("'limit': z.coerce.number().int().min(1).max(1000)"),
      `Generated getUsers schema should preserve coerce for limit but got: ${getUsersZod}`,
    );

    // Find getUserById schema in generated output
    let getUserByIdZod = '';
    for (const ops of Object.values(groups)) {
      for (const op of ops) {
        if (op.operationId === 'getUserById') {
          getUserByIdZod = Object.values(op.schemas)[0] ?? '';
        }
      }
    }

    assert.ok(getUserByIdZod, 'Should have generated getUserById schema');
    assert.ok(
      getUserByIdZod.includes('z.coerce.number().int().gt(0)'),
      `Generated getUserById Zod schema should preserve coerce but got: ${getUserByIdZod}`,
    );
  });

  it('should preserve integer type when using external imported schemas', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'inputs.ts': `
import { z } from 'zod';

export const pageNumberSchema = z.coerce
  .number()
  .int()
  .positive()
  .default(1)
  .nullish()
  .transform((value) => (value === null || value === undefined ? 1 : value));

export const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(50)
  .nullish()
  .transform((value) => (value === null || value === undefined ? 50 : value));

export const intLikeSchema = z.coerce.number().int().positive();
`,
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import * as inputs from './inputs';

const app = new Hono();

/**
 * @openapi getUsers
 * @tags users
 */
app.get('/users', validate((payload) => ({
  page: {
    select: payload.query.page,
    against: inputs.pageNumberSchema,
  },
  limit: {
    select: payload.query.limit,
    against: inputs.pageSizeSchema,
  },
})), (c) => {
  return c.json({ users: [] });
});

/**
 * @openapi getUserById
 * @tags users
 */
app.get('/users/:userId', validate((payload) => ({
  userId: {
    select: payload.params.userId,
    against: inputs.intLikeSchema,
  },
})), (c) => {
  return c.json({ id: 1 });
});
`,
    });

    const inputsPath = join(workspace.path, 'inputs.ts');
    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
      imports: [
        {
          import: 'inputs',
          from: inputsPath,
        },
      ],
    });

    // Check getUsers parameters
    const getUsers = result.paths['/users']?.get;
    assert.ok(getUsers, 'Should have GET /users');

    const params = (getUsers.parameters ?? []).flatMap((parameter) =>
      isReferenceObject(parameter) ? [] : [parameter],
    );

    const pageParam = params.find((p) => p.name === 'page');
    assert.ok(pageParam, 'Should have page parameter');

    const pageInnerSchema = getNonNullBranch(pageParam.schema);
    assert.strictEqual(
      pageInnerSchema.type,
      'integer',
      'page parameter should have type "integer" when using external import',
    );
    assert.strictEqual(
      pageInnerSchema['x-zod-type'],
      'coerce-number',
      'page parameter should preserve x-zod-type when using external import',
    );

    const limitParam = params.find((p) => p.name === 'limit');
    assert.ok(limitParam, 'Should have limit parameter');

    const limitInnerSchema = getNonNullBranch(limitParam.schema);
    assert.strictEqual(
      limitInnerSchema.type,
      'integer',
      'limit parameter should have type "integer" when using external import',
    );
    assert.strictEqual(
      limitInnerSchema['x-zod-type'],
      'coerce-number',
      'limit parameter should preserve x-zod-type when using external import',
    );

    const getUserById = result.paths['/users/{userId}']?.get;
    assert.ok(getUserById, 'Should have GET /users/{userId}');

    const byIdParams = (getUserById.parameters ?? []).flatMap((parameter) =>
      isReferenceObject(parameter) ? [] : [parameter],
    );
    const userIdParam = byIdParams.find((p) => p.name === 'userId');
    assert.ok(userIdParam, 'Should have userId parameter');
    const userIdSchema = userIdParam.schema;
    assert.ok(
      userIdSchema && isSchemaObject(userIdSchema),
      'userId parameter should have an inline schema',
    );
    assert.strictEqual(
      userIdSchema.type,
      'integer',
      'userId parameter should have type "integer" when using external import',
    );
    assert.strictEqual(
      userIdSchema['x-zod-type'],
      'coerce-number',
      'userId parameter should preserve x-zod-type when using external import',
    );

    // Full pipeline check
    const { toIR } = await import('@sdk-it/spec');
    const { createModelNamer, generateCode } =
      await import('@sdk-it/typescript');

    const spec = {
      openapi: '3.1.0' as const,
      info: { title: 'Test', version: '1.0.0' },
      paths: result.paths,
      components: result.components,
    };

    const ir = await toIR(
      { spec, responses: { flattenErrorResponses: true }, pagination: false },
      false,
    );

    const { groups } = generateCode({
      spec: ir,
      style: { name: 'github' },
      makeImport: (m: string) => m + '.ts',
      modelName: createModelNamer('Client'),
    });

    let getUsersZod = '';
    for (const ops of Object.values(groups)) {
      for (const op of ops) {
        if (op.operationId === 'getUsers') {
          getUsersZod = Object.values(op.schemas)[0] ?? '';
        }
      }
    }

    assert.ok(getUsersZod, 'Should have generated getUsers schema');
    assert.ok(
      getUsersZod.includes("'page': z.coerce.number().int().gt(0)"),
      `Generated getUsers schema from external import should preserve coerce for page but got: ${getUsersZod}`,
    );
    assert.ok(
      getUsersZod.includes("'limit': z.coerce.number().int().min(1).max(1000)"),
      `Generated getUsers schema from external import should preserve coerce for limit but got: ${getUsersZod}`,
    );

    let getUserByIdZod = '';
    for (const ops of Object.values(groups)) {
      for (const op of ops) {
        if (op.operationId === 'getUserById') {
          getUserByIdZod = Object.values(op.schemas)[0] ?? '';
        }
      }
    }

    assert.ok(getUserByIdZod, 'Should have generated getUserById schema');
    assert.ok(
      getUserByIdZod.includes('z.coerce.number().int().gt(0)'),
      `Generated getUserById schema from external import should preserve coerce but got: ${getUserByIdZod}`,
    );
  });

  it('characterizes union of string and string literals in response type', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

type EmployeePosition =
  | string
  | 'Director'
  | 'Associate Director'
  | 'Project Leader'
  | 'Delivery Leader'
  | 'Associate'
  | 'Analyst'
  | 'Unknown';

declare const examplePosition: EmployeePosition;

/** @openapi getEmployee @tags employees */
app.get('/employee', validate(() => ({})), (c) => {
  return output.json({ position: examplePosition });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    const schema =
      result.paths['/employee']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;
    assert.ok(schema, 'Should have 200 response schema');

    const positionSchema = schema.properties?.position;
    assert.deepStrictEqual(positionSchema, { type: 'string' });
  });

  it('preserves literals when bare string is wrapped in (string & {})', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();
const output = {
  json: (value: unknown, status = 200) => Response.json(value, { status }),
};

type EmployeePosition =
  | (string & {})
  | 'Director'
  | 'Associate Director'
  | 'Project Leader'
  | 'Delivery Leader'
  | 'Associate'
  | 'Analyst'
  | 'Unknown';

declare const examplePosition: EmployeePosition;

/** @openapi getEmployee @tags employees */
app.get('/employee', validate(() => ({})), (c) => {
  return output.json({ position: examplePosition });
});
`,
    });

    using project = openAnalysisProject(workspace.tsconfig);
    const result = await analyze(project, {
      responseAnalyzer: responseAnalyzer,
    });

    const schema =
      result.paths['/employee']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;
    assert.ok(schema, 'Should have 200 response schema');

    const positionSchema = schema.properties?.position;
    assert.ok(
      Array.isArray(positionSchema?.anyOf),
      'position schema should be an anyOf union',
    );
    const members: SchemaObject[] = positionSchema.anyOf;
    assert.ok(
      members.some(
        (m) => m.type === 'string' && !m.enum && !m.const && !m.format,
      ),
      'should preserve the bare string member',
    );
    const literals = members
      .filter((m) => Array.isArray(m.enum) && m.type === 'string')
      .flatMap((m) => m.enum);
    assert.deepStrictEqual(
      [...literals].sort(),
      [
        'Analyst',
        'Associate',
        'Associate Director',
        'Delivery Leader',
        'Director',
        'Project Leader',
        'Unknown',
      ],
      'should preserve all 7 string literals',
    );
  });

  it('reuses UIMessage through an OpenAPI component', async () => {
    const result = await analyzeUIMessage();
    const reference = { $ref: '#/components/schemas/UIMessage' };
    const responseItems = ['/first', '/second'].map(
      (path) =>
        result.paths[path]?.get?.responses?.['200']?.content?.[
          'application/json'
        ]?.schema?.properties?.messages?.items,
    );

    assert.ok(result.components.schemas?.UIMessage);
    assert.deepStrictEqual(responseItems, [reference, reference]);
  });

  it('does not emit undefined as an OpenAPI type for UIMessage', async () => {
    const result = await analyzeUIMessage();

    assert.doesNotMatch(JSON.stringify(result), /"type":"undefined"/);
  });
});

async function requestBodyField(source: string) {
  await using workspace = await analysisWorkspace('generic-body-', {
    'index.ts': source,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const result = await analyze(project, {
    responseAnalyzer: responseAnalyzer,
  });
  const op = result.paths['/x']?.post;
  assert.ok(op, 'Should have POST /x');
  const requestBody = op.requestBody;
  const body =
    requestBody && 'content' in requestBody
      ? requestBody.content?.['application/json']?.schema
      : undefined;
  assert.ok(body && 'properties' in body, 'Should have request body schema');
  return {
    field: inlineSchema(body.properties?.field),
    required: body.required ?? [],
  };
}

function inlineSchema(
  schema: SchemaObject | ReferenceObject | undefined,
): SchemaObject {
  assert.ok(schema && isSchemaObject(schema), 'Should have an inline schema');
  return schema;
}

function bodySource(againstExpr: string, extraImports = '') {
  return `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';
${extraImports}

const app = new Hono();

/** @openapi op @tags x */
app.post('/x', validate((p) => ({
  field: { select: p.body.field, against: ${againstExpr} }
})), (c) => {
  return c.json({ ok: true });
});
`;
}

describe('zod v3 → v4 migration characterization: string formats', () => {
  it('z.string().email() emits format=email', async () => {
    const { field } = await requestBodyField(bodySource('z.string().email()'));
    assert.deepStrictEqual(field, {
      type: 'string',
      format: 'email',
    });
  });

  it('z.string().uuid() emits format=uuid', async () => {
    const { field } = await requestBodyField(bodySource('z.string().uuid()'));
    assert.deepStrictEqual(field, {
      type: 'string',
      format: 'uuid',
    });
  });

  it('z.string().url() emits format=uri', async () => {
    const { field } = await requestBodyField(bodySource('z.string().url()'));
    assert.deepStrictEqual(field, {
      type: 'string',
      format: 'uri',
    });
  });

  it('z.string().datetime() emits format=date-time', async () => {
    const { field } = await requestBodyField(
      bodySource('z.string().datetime()'),
    );
    assert.deepStrictEqual(field, {
      type: 'string',
      format: 'date-time',
    });
  });

  it('z.string().date() emits format=date', async () => {
    const { field } = await requestBodyField(bodySource('z.string().date()'));
    assert.deepStrictEqual(field, {
      type: 'string',
      format: 'date',
    });
  });

  it('z.string().ip({ version: "v4" }) emits format=ipv4', async () => {
    const { field } = await requestBodyField(
      bodySource(`z.string().ip({ version: 'v4' })`),
    );
    assert.deepStrictEqual(field, {
      type: 'string',
      format: 'ipv4',
    });
  });

  it('z.string().ip({ version: "v6" }) emits format=ipv6', async () => {
    const { field } = await requestBodyField(
      bodySource(`z.string().ip({ version: 'v6' })`),
    );
    assert.deepStrictEqual(field, {
      type: 'string',
      format: 'ipv6',
    });
  });

  it('z.string().min(n).max(n) emits minLength/maxLength', async () => {
    const { field } = await requestBodyField(
      bodySource('z.string().min(3).max(10)'),
    );
    assert.deepStrictEqual(field, {
      type: 'string',
      minLength: 3,
      maxLength: 10,
    });
  });
});

describe('zod v3 → v4 migration characterization: primitives', () => {
  it('z.boolean() emits type=boolean', async () => {
    const { field } = await requestBodyField(bodySource('z.boolean()'));
    assert.deepStrictEqual(field, { type: 'boolean' });
  });

  it('z.bigint() is interpreted as int64', async () => {
    const { field } = await requestBodyField(bodySource('z.bigint()'));
    assert.deepStrictEqual(field, {
      type: 'integer',
      format: 'int64',
    });
  });

  it('z.int64() emits integer with int64 format', async () => {
    const { field } = await requestBodyField(bodySource('z.int64()'));
    assert.deepStrictEqual(field, {
      type: 'integer',
      format: 'int64',
    });
  });

  it('z.literal(string) emits const string', async () => {
    const { field } = await requestBodyField(bodySource(`z.literal('foo')`));
    assert.deepStrictEqual(field, {
      type: 'string',
      const: 'foo',
    });
  });

  it('z.literal(number) emits const number', async () => {
    const { field } = await requestBodyField(bodySource('z.literal(42)'));
    assert.deepStrictEqual(field, {
      type: 'number',
      const: 42,
    });
  });

  it('z.literal(boolean) emits const boolean', async () => {
    const { field } = await requestBodyField(bodySource('z.literal(true)'));
    assert.deepStrictEqual(field, {
      type: 'boolean',
      const: true,
    });
  });

  it('z.enum([...]) emits string with enum members', async () => {
    const { field } = await requestBodyField(
      bodySource(`z.enum(['a','b','c'])`),
    );
    assert.deepStrictEqual(field, {
      type: 'string',
      enum: ['a', 'b', 'c'],
    });
  });

  it('z.nativeEnum(inlineRecord) emits number with enum members', async () => {
    const { field } = await requestBodyField(
      bodySource('z.nativeEnum({ A: 1, B: 2 })'),
    );
    assert.deepStrictEqual(field, {
      type: 'number',
      enum: [1, 2],
    });
  });

  it('z.nativeEnum referencing a non-imported local identifier throws (analyzer requires self-contained expressions)', async () => {
    await assert.rejects(
      requestBodyField(
        bodySource('z.nativeEnum(MyEnum)', 'enum MyEnum { A = 1, B = 2 }'),
      ),
      /MyEnum is not defined/,
    );
  });

  it('against expression with TS-only syntax (as const) fails to evaluate', async () => {
    await assert.rejects(
      requestBodyField(bodySource('z.nativeEnum({ A: 1, B: 2 } as const)')),
      /missing \) after argument list/,
    );
  });
});

describe('zod v3 → v4 migration characterization: collections', () => {
  it('z.array(z.string()) emits array with items', async () => {
    const { field } = await requestBodyField(bodySource('z.array(z.string())'));
    assert.deepStrictEqual(field, {
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('z.tuple([...]) emits array with positional items', async () => {
    const { field } = await requestBodyField(
      bodySource('z.tuple([z.string(), z.number()])'),
    );
    assert.deepStrictEqual(field, {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('z.record(z.string(), z.number()) emits object with additionalProperties', async () => {
    const { field } = await requestBodyField(
      bodySource('z.record(z.string(), z.number())'),
    );
    assert.deepStrictEqual(field, {
      type: 'object',
      additionalProperties: { type: 'number' },
    });
  });

  it('z.object({...}).catchall(z.number()) emits typed additionalProperties', async () => {
    const { field } = await requestBodyField(
      bodySource('z.object({ a: z.string() }).catchall(z.number())'),
    );
    assert.deepStrictEqual(field, {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: { type: 'number' },
    });
  });

  it('z.object({...}).strict() emits additionalProperties=false', async () => {
    const { field } = await requestBodyField(
      bodySource('z.object({ a: z.string() }).strict()'),
    );
    assert.deepStrictEqual(field, {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('z.object({...}).passthrough() emits permissive additionalProperties (zod v4 emits {} instead of true — semantically identical)', async () => {
    const { field } = await requestBodyField(
      bodySource('z.object({ a: z.string() }).passthrough()'),
    );
    assert.deepStrictEqual(field, {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: {},
    });
  });

  it('nested z.object schemas preserve structure', async () => {
    const { field } = await requestBodyField(
      bodySource(
        'z.object({ inner: z.object({ x: z.string(), y: z.number() }) })',
      ),
    );
    assert.deepStrictEqual(field, {
      type: 'object',
      properties: {
        inner: {
          type: 'object',
          properties: {
            x: { type: 'string' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
      },
      required: ['inner'],
      additionalProperties: false,
    });
  });
});

describe('zod v3 → v4 migration characterization: composition', () => {
  it('z.union([string, number]) emits a union', async () => {
    const { field } = await requestBodyField(
      bodySource('z.union([z.string(), z.number()])'),
    );
    const variants = field.anyOf ?? field.oneOf;
    if (variants) {
      const types = variants.map((v: any) => v.type).sort();
      assert.deepStrictEqual(types, ['number', 'string']);
    } else {
      assert.ok(
        Array.isArray(field.type),
        'union -> anyOf, oneOf or type array',
      );
      assert.deepStrictEqual([...field.type].sort(), ['number', 'string']);
    }
  });

  it('z.discriminatedUnion emits anyOf of object schemas', async () => {
    const { field } = await requestBodyField(
      bodySource(
        `z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), x: z.string() }),
          z.object({ kind: z.literal('b'), y: z.number() }),
        ])`,
      ),
    );
    assert.ok(Array.isArray(field.anyOf), 'discriminatedUnion -> anyOf');
    assert.strictEqual(field.anyOf.length, 2);
    assert.strictEqual(
      inlineSchema(inlineSchema(field.anyOf[0]).properties?.kind).const,
      'a',
    );
    assert.strictEqual(
      inlineSchema(inlineSchema(field.anyOf[1]).properties?.kind).const,
      'b',
    );
  });

  it('z.intersection emits allOf', async () => {
    const { field } = await requestBodyField(
      bodySource(
        'z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))',
      ),
    );
    assert.ok(
      Array.isArray(field.allOf) ||
        (field.type === 'object' && field.properties),
      'intersection -> allOf or merged object',
    );
    if (Array.isArray(field.allOf)) {
      assert.strictEqual(field.allOf.length, 2);
    }
  });
});

describe('zod v3 → v4 migration characterization: modifiers', () => {
  it('.optional() marks the field as not required', async () => {
    const { field, required } = await requestBodyField(
      bodySource('z.string().optional()'),
    );
    assert.deepStrictEqual(field, { type: 'string' });
    assert.ok(!required.includes('field'), 'field should not be required');
  });

  it('.nullable() emits anyOf with null branch', async () => {
    const { field } = await requestBodyField(
      bodySource('z.string().nullable()'),
    );
    const hasNull =
      (Array.isArray(field.anyOf) &&
        field.anyOf.some((c: any) => c.type === 'null')) ||
      (Array.isArray(field.oneOf) &&
        field.oneOf.some((c: any) => c.type === 'null')) ||
      (Array.isArray(field.type) && field.type.includes('null'));
    assert.ok(hasNull, 'nullable must include a null branch');
  });

  it('.nullish() makes field optional with null branch', async () => {
    const { field, required } = await requestBodyField(
      bodySource('z.string().nullish()'),
    );
    assert.ok(
      !required.includes('field'),
      'nullish field should not be required',
    );
    const hasNull =
      (Array.isArray(field.anyOf) &&
        field.anyOf.some((c: any) => c.type === 'null')) ||
      (Array.isArray(field.oneOf) &&
        field.oneOf.some((c: any) => c.type === 'null')) ||
      (Array.isArray(field.type) && field.type.includes('null'));
    assert.ok(hasNull, 'nullish must include a null branch');
  });

  it('.default(value) emits default key', async () => {
    const { field } = await requestBodyField(
      bodySource(`z.string().default('hi')`),
    );
    assert.strictEqual(field.default, 'hi');
    assert.strictEqual(field.type, 'string');
  });

  it('.describe("...") emits description', async () => {
    const { field } = await requestBodyField(
      bodySource(`z.string().describe('a name')`),
    );
    assert.strictEqual(field.description, 'a name');
    assert.strictEqual(field.type, 'string');
  });

  it('.refine(...) does not add to the emitted schema (passes through)', async () => {
    const { field } = await requestBodyField(
      bodySource('z.string().refine((v) => v.length > 0)'),
    );
    assert.deepStrictEqual(field, { type: 'string' });
  });

  it('.transform(...) keeps the input schema type (effectStrategy: input)', async () => {
    const { field } = await requestBodyField(
      bodySource('z.string().transform((v) => v.length)'),
    );
    assert.deepStrictEqual(field, { type: 'string' });
  });

  it('.pipe(...) preserves the chained input shape', async () => {
    const { field } = await requestBodyField(
      bodySource('z.string().pipe(z.string().min(1))'),
    );
    const isAllOf = Array.isArray(field.allOf);
    const isMergedString = field.type === 'string' && field.minLength === 1;
    assert.ok(
      isAllOf || isMergedString,
      `pipe should emit allOf or a merged string schema, got ${JSON.stringify(field)}`,
    );
  });

  it('.brand("...") is transparent in the JSON schema', async () => {
    const { field } = await requestBodyField(
      bodySource(`z.string().brand('UserId')`),
    );
    assert.deepStrictEqual(field, { type: 'string' });
  });
});

describe('zod v3 → v4 migration characterization: coerce variants', () => {
  it('z.coerce.string() carries x-zod-type=coerce-string', async () => {
    const { field } = await requestBodyField(bodySource('z.coerce.string()'));
    assert.strictEqual(field.type, 'string');
    assert.strictEqual(field['x-zod-type'], 'coerce-string');
  });

  it('z.coerce.boolean() carries x-zod-type=coerce-boolean', async () => {
    const { field } = await requestBodyField(bodySource('z.coerce.boolean()'));
    assert.strictEqual(field.type, 'boolean');
    assert.strictEqual(field['x-zod-type'], 'coerce-boolean');
  });

  it('z.coerce.bigint() carries x-zod-type=coerce-bigint', async () => {
    const { field } = await requestBodyField(bodySource('z.coerce.bigint()'));
    assert.strictEqual(field.type, 'integer');
    assert.strictEqual(field['x-zod-type'], 'coerce-bigint');
  });
});

describe('zod v3 → v4 migration characterization: recursive (z.lazy)', () => {
  it('inline z.lazy with a non-recursive body resolves to an object schema', async () => {
    const { field } = await requestBodyField(
      bodySource('z.lazy(() => z.object({ value: z.string() }))'),
    );
    assert.deepStrictEqual(field, {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    });
  });

  it('z.lazy referencing an enclosing schema variable throws (analyzer requires self-contained expressions)', async () => {
    await using workspace = await analysisWorkspace('generic-', {
      'index.ts': `
import { validate } from '@sdk-it/hono/runtime';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

type Node = { value: string; next?: Node };
const nodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({ value: z.string(), next: nodeSchema.optional() })
);

/** @openapi op @tags x */
app.post('/x', validate((p) => ({
  field: { select: p.body.field, against: nodeSchema }
})), (c) => {
  return c.json({ ok: true });
});
`,
    });
    using project = openAnalysisProject(workspace.tsconfig);
    await assert.rejects(
      analyze(project, {
        responseAnalyzer: responseAnalyzer,
      }),
      /nodeSchema is not defined/,
    );
  });
});
