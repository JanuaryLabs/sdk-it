import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { writeFiles } from '@sdk-it/core/file-system.js';

import { analyze } from './generic.ts';
import { responseAnalyzer } from './response-analyzer.ts';

const tsconfig = {
	compilerOptions: {
		target: 'ES2022',
		module: 'ESNext',
		moduleResolution: 'bundler',
		strict: true,
		esModuleInterop: true,
		skipLibCheck: true,
		forceConsistentCasingInFileNames: true,
	},
	include: ['src/**/*'],
};

async function tsworkspace(
  config: Record<string, unknown>,
  files: Record<string, string>,
) {
  const dir = join(tmpdir(), 'sdk-it', crypto.randomUUID());
  await writeFiles(join(dir, 'src'), files);
  await writeFiles(dir, {
    'tsconfig.json': JSON.stringify(config, null, 2),
  });
  return {
    tsconfig: join(dir, 'tsconfig.json'),
    [Symbol.asyncDispose]: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function getNonNullBranch(schema: any) {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.find((candidate: any) => candidate.type !== 'null');
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.find((candidate: any) => candidate.type !== 'null');
  }
  return schema;
}

describe('analyze function tests', () => {
  it('should parse basic validation middleware with selectors', async () => {
    // Test Case 1: Basic validation middleware with query and body selectors
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'test1.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  post: (path: string, middleware: any, handler: any) => {}
};

/**
 * @openapi getUserProfile
 * @tags user
 * @description Get user profile information
 */
app.post('/users/:id/profile', validate(({ query, body, params }) => ({
  userId: { select: params.id, against: z.string() },
  name: { select: body.name, against: z.string() },
  email: { select: query.email, against: z.string().email().optional() }
})), (c) => {
  return output.json({ success: true, user: c.get('input') });
});
`,
      },
    );

    const result1 = await analyze(workspace.tsconfig, {
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
  });

  it('should handle error responses with ProblemDetailsException', async () => {
    // Test Case 2: Error response handling with ProblemDetailsException
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'test2.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, middleware: any, handler: any) => {}
};

class ProblemDetailsException extends Error {}

/**
 * @openapi getResource
 * @summary Get a resource that might not exist
 */
app.get('/resource/:id', validate(({ params }) => ({
  id: { select: params.id, against: z.string() }
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
      },
    );

    const result2 = await analyze(workspace.tsconfig, {
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
    await using workspace = await tsworkspace(
tsconfig,
      {
        'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, middleware: any, handler: any) => {},
  post: (path: string, middleware: any, handler: any) => {},
  put: (path: string, middleware: any, handler: any) => {}
};

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
      },
    );

    const result = await analyze(workspace.tsconfig, {
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
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'test4.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  post: (path: string, ...args: any[]) => {}
};

class HTTPException extends Error {}

const authenticate = () => (ctx: any) => {
  const token = ctx.headers.get('Authorization');
  if (!token) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  return ctx;
};

const ratelimit = () => (ctx: any) => {
  const limit = ctx.headers.get('X-RateLimit-Remaining');
  if (limit === '0') {
    throw new HTTPException(429, { message: 'Too many requests' });
  }
  return ctx;
};

const earlyReturn = () => (ctx: any) => {
  if (ctx.query.get('skip') === 'true') {
    return output.json({ skipped: true }, 202);
  }
  return ctx;
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
      },
    );

    const result = await analyze(workspace.tsconfig, {
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

  it('should follow call expressions into helper functions', async () => {
    // Test Case 5: Recursive call expression following
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'test5.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  post: (path: string, ...args: any[]) => {}
};

class HTTPException extends Error {}

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
function parseJson(context: any) {
  verifyContentType(context.headers.get('content-type'));
  try {
    return context.req.json();
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
      },
    );

    const result = await analyze(workspace.tsconfig, {
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
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  post: (path: string, middleware: any, handler: any) => {}
};

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
      },
    );

    const result = await analyze(workspace.tsconfig, {
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
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  post: (path: string, middleware: any, handler: any) => {}
};

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
      },
    );

    const result = await analyze(workspace.tsconfig, {
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

    const props = body.properties as Record<string, unknown>;

    // optional z.date() preserves x-zod-type and is not required
    assert.deepStrictEqual(props.scheduledAt, {
      type: 'string',
      format: 'date-time',
      'x-zod-type': 'date',
    });
    assert.ok(
      !((body as any).required ?? []).includes('scheduledAt'),
      'scheduledAt should not be required',
    );

    // optional z.coerce.date() preserves x-zod-type and is not required
    assert.deepStrictEqual(props.coercedDate, {
      type: 'string',
      format: 'date-time',
      'x-zod-type': 'coerce-date',
    });
    assert.ok(
      !((body as any).required ?? []).includes('coercedDate'),
      'coercedDate should not be required',
    );
  });

  it('should handle date validators in query params', async () => {
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, middleware: any, handler: any) => {}
};

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
      },
    );

    const result = await analyze(workspace.tsconfig, {
      responseAnalyzer: responseAnalyzer,
    });

    const operation = result.paths['/events']?.get;
    assert.ok(operation, 'Should have GET /events');

    const params = (operation.parameters ?? []) as Array<{
      name: string;
      required: boolean;
      schema: unknown;
    }>;
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
    await using workspace = await tsworkspace(
      tsconfig,
      {
        'test6.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, ...args: any[]) => {}
};

class HTTPException extends Error {}

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
      },
    );

    const result = await analyze(workspace.tsconfig, {
      responseAnalyzer: responseAnalyzer,
    });

    const deepPath = result.paths['/deep']?.get;
    assert.ok(deepPath, 'Should have deep GET endpoint');

    // With default max depth of 5, should capture the exception at level 5
    // Depth 0: handler -> Depth 1: level1 -> Depth 2: level2 ->
    // Depth 3: level3 -> Depth 4: level4 -> Depth 5: level5
  });

  it('should deduplicate named middleware responses across operations', async () => {
    await using workspace = await tsworkspace(tsconfig, {
      'test.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, ...args: any[]) => {},
  post: (path: string, ...args: any[]) => {},
};

class ProblemDetailsException extends Error {}

const authenticate = () => (ctx: any) => {
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

    const result = await analyze(workspace.tsconfig, {
      responseAnalyzer: responseAnalyzer,
    });

    // Shared middleware schema should exist once in components
    const sharedKey = 'authenticate401_application_problem+json';
    assert.ok(result.components.schemas?.[sharedKey],
      'Should have shared schema for authenticate 401');

    // Both operations should reference the shared schema via $ref
    const listUsers = result.paths['/users']?.get;
    const createUser = result.paths['/users']?.post;
    const listRef = listUsers?.responses?.['401']?.content?.['application/problem+json']?.schema;
    const createRef = createUser?.responses?.['401']?.content?.['application/problem+json']?.schema;
    assert.deepStrictEqual(listRef, { $ref: `#/components/schemas/${sharedKey}` });
    assert.deepStrictEqual(createRef, { $ref: `#/components/schemas/${sharedKey}` });
  });

  it('should not deduplicate anonymous middleware responses', async () => {
    await using workspace = await tsworkspace(tsconfig, {
      'test.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, ...args: any[]) => {},
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

    const result = await analyze(workspace.tsconfig, {
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
    const schema200 = getItem?.responses?.['200']?.content?.['application/json']?.schema;
    assert.ok(schema200 && !('$ref' in schema200), '200 response should be inlined');
  });

  it('should preserve integer type for z.number().int() in query and path params', async () => {
    await using workspace = await tsworkspace(tsconfig, {
      'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, ...args: any[]) => {}
};

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

    const result = await analyze(workspace.tsconfig, {
      responseAnalyzer: responseAnalyzer,
    });

    // Check getUsers parameters
    const getUsers = result.paths['/users']?.get;
    assert.ok(getUsers, 'Should have GET /users');

    const params = (getUsers.parameters ?? []) as Array<{
      name: string;
      schema: any;
    }>;

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

    const byIdParams = (getUserById.parameters ?? []) as Array<{
      name: string;
      schema: any;
    }>;
    const userIdParam = byIdParams.find((p) => p.name === 'userId');
    assert.ok(userIdParam, 'Should have userId parameter');
    assert.strictEqual(
      userIdParam.schema.type,
      'integer',
      'userId parameter should have type "integer" (from .int())',
    );
    assert.strictEqual(
      userIdParam.schema['x-zod-type'],
      'coerce-number',
      'userId parameter should preserve x-zod-type',
    );

    // Full pipeline: analyze → toIR → generateCode → assert .int() in Zod output
    const { toIR } = await import('@sdk-it/spec');
    const { generateCode } = await import('@sdk-it/typescript');

    const spec = {
      openapi: '3.1.0' as const,
      info: { title: 'Test', version: '1.0.0' },
      paths: result.paths,
      components: result.components,
    };

    const ir = toIR(
      { spec, responses: { flattenErrorResponses: true }, pagination: false },
      false,
    );

    const { groups } = generateCode({
      spec: ir,
      style: { name: 'github' },
      makeImport: (m: string) => m + '.ts',
    });

    // Find getUsers schema in generated output
    let getUsersZod = '';
    for (const ops of Object.values(groups)) {
      for (const op of ops) {
        if (op.operationId === 'getUsers') {
          getUsersZod = Object.values(op.schemas)[0] as string;
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
          getUserByIdZod = Object.values(op.schemas)[0] as string;
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
    await using workspace = await tsworkspace(tsconfig, {
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
import { validate } from 'hono';
import * as inputs from './inputs';

const app = {
  get: (path: string, ...args: any[]) => {}
};

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

    // Symlink node_modules so the imported inputs.ts can resolve 'zod'
    const projectRoot = join(workspace.tsconfig, '..', '..');
    const nodeModulesPath = join(projectRoot, 'node_modules');
    try {
      await symlink(
        join(process.cwd(), 'node_modules'),
        nodeModulesPath,
        'dir',
      );
    } catch {
      // symlink may already exist
    }

    const inputsPath = join(workspace.tsconfig, '..', 'src', 'inputs.ts');
    const result = await analyze(workspace.tsconfig, {
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

    const params = (getUsers.parameters ?? []) as Array<{
      name: string;
      schema: any;
    }>;

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

    const byIdParams = (getUserById.parameters ?? []) as Array<{
      name: string;
      schema: any;
    }>;
    const userIdParam = byIdParams.find((p) => p.name === 'userId');
    assert.ok(userIdParam, 'Should have userId parameter');
    assert.strictEqual(
      userIdParam.schema.type,
      'integer',
      'userId parameter should have type "integer" when using external import',
    );
    assert.strictEqual(
      userIdParam.schema['x-zod-type'],
      'coerce-number',
      'userId parameter should preserve x-zod-type when using external import',
    );

    // Full pipeline check
    const { toIR } = await import('@sdk-it/spec');
    const { generateCode } = await import('@sdk-it/typescript');

    const spec = {
      openapi: '3.1.0' as const,
      info: { title: 'Test', version: '1.0.0' },
      paths: result.paths,
      components: result.components,
    };

    const ir = toIR(
      { spec, responses: { flattenErrorResponses: true }, pagination: false },
      false,
    );

    const { groups } = generateCode({
      spec: ir,
      style: { name: 'github' },
      makeImport: (m: string) => m + '.ts',
    });

    let getUsersZod = '';
    for (const ops of Object.values(groups)) {
      for (const op of ops) {
        if (op.operationId === 'getUsers') {
          getUsersZod = Object.values(op.schemas)[0] as string;
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
          getUserByIdZod = Object.values(op.schemas)[0] as string;
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
    await using workspace = await tsworkspace(tsconfig, {
      'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, ...args: any[]) => {},
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

    const result = await analyze(workspace.tsconfig, {
      responseAnalyzer: responseAnalyzer,
    });

    const schema = result.paths['/employee']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema as any;
    assert.ok(schema, 'Should have 200 response schema');

    const positionSchema = schema.properties?.position;
    assert.deepStrictEqual(positionSchema, { type: 'string' });
  });

  it('preserves literals when bare string is wrapped in (string & {})', async () => {
    await using workspace = await tsworkspace(tsconfig, {
      'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = {
  get: (path: string, ...args: any[]) => {},
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

    const result = await analyze(workspace.tsconfig, {
      responseAnalyzer: responseAnalyzer,
    });

    const schema = result.paths['/employee']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema as any;
    assert.ok(schema, 'Should have 200 response schema');

    const positionSchema = schema.properties?.position;
    assert.ok(
      Array.isArray(positionSchema?.anyOf),
      'position schema should be an anyOf union',
    );
    const members = positionSchema.anyOf as any[];
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
});

async function analyzeRequestBody(source: string) {
  const workspace = await tsworkspace(tsconfig, { 'index.ts': source });
  try {
    const result = await analyze(workspace.tsconfig, {
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
    return body as any;
  } finally {
    await workspace[Symbol.asyncDispose]();
  }
}

function bodySource(againstExpr: string, extraImports = '') {
  return `
import { validate } from 'hono';
import { z } from 'zod';
${extraImports}

const app = { post: (path: string, middleware: any, handler: any) => {} };

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
    const body = await analyzeRequestBody(bodySource('z.string().email()'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      format: 'email',
    });
  });

  it('z.string().uuid() emits format=uuid', async () => {
    const body = await analyzeRequestBody(bodySource('z.string().uuid()'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      format: 'uuid',
    });
  });

  it('z.string().url() emits format=uri', async () => {
    const body = await analyzeRequestBody(bodySource('z.string().url()'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      format: 'uri',
    });
  });

  it('z.string().datetime() emits format=date-time', async () => {
    const body = await analyzeRequestBody(bodySource('z.string().datetime()'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      format: 'date-time',
    });
  });

  it('z.string().date() emits format=date', async () => {
    const body = await analyzeRequestBody(bodySource('z.string().date()'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      format: 'date',
    });
  });

  it('z.string().ip({ version: "v4" }) emits format=ipv4', async () => {
    const body = await analyzeRequestBody(
      bodySource(`z.string().ip({ version: 'v4' })`),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      format: 'ipv4',
    });
  });

  it('z.string().ip({ version: "v6" }) emits format=ipv6', async () => {
    const body = await analyzeRequestBody(
      bodySource(`z.string().ip({ version: 'v6' })`),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      format: 'ipv6',
    });
  });

  it('z.string().min(n).max(n) emits minLength/maxLength', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.string().min(3).max(10)'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      minLength: 3,
      maxLength: 10,
    });
  });
});

describe('zod v3 → v4 migration characterization: primitives', () => {
  it('z.boolean() emits type=boolean', async () => {
    const body = await analyzeRequestBody(bodySource('z.boolean()'));
    assert.deepStrictEqual(body.properties.field, { type: 'boolean' });
  });

  it('z.bigint() is interpreted as int64', async () => {
    const body = await analyzeRequestBody(bodySource('z.bigint()'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'integer',
      format: 'int64',
    });
  });

  it('z.int64() emits integer with int64 format', async () => {
    const body = await analyzeRequestBody(bodySource('z.int64()'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'integer',
      format: 'int64',
    });
  });

  it('z.literal(string) emits const string', async () => {
    const body = await analyzeRequestBody(bodySource(`z.literal('foo')`));
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      const: 'foo',
    });
  });

  it('z.literal(number) emits const number', async () => {
    const body = await analyzeRequestBody(bodySource('z.literal(42)'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'number',
      const: 42,
    });
  });

  it('z.literal(boolean) emits const boolean', async () => {
    const body = await analyzeRequestBody(bodySource('z.literal(true)'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'boolean',
      const: true,
    });
  });

  it('z.enum([...]) emits string with enum members', async () => {
    const body = await analyzeRequestBody(
      bodySource(`z.enum(['a','b','c'])`),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'string',
      enum: ['a', 'b', 'c'],
    });
  });

  it('z.nativeEnum(inlineRecord) emits number with enum members', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.nativeEnum({ A: 1, B: 2 })'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'number',
      enum: [1, 2],
    });
  });

  it('z.nativeEnum referencing a non-imported local identifier throws (analyzer requires self-contained expressions)', async () => {
    await assert.rejects(
      analyzeRequestBody(
        bodySource('z.nativeEnum(MyEnum)', 'enum MyEnum { A = 1, B = 2 }'),
      ),
      /MyEnum is not defined/,
    );
  });

  it('against expression with TS-only syntax (as const) fails to evaluate', async () => {
    await assert.rejects(
      analyzeRequestBody(bodySource('z.nativeEnum({ A: 1, B: 2 } as const)')),
      /missing \) after argument list/,
    );
  });
});

describe('zod v3 → v4 migration characterization: collections', () => {
  it('z.array(z.string()) emits array with items', async () => {
    const body = await analyzeRequestBody(bodySource('z.array(z.string())'));
    assert.deepStrictEqual(body.properties.field, {
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('z.tuple([...]) emits array with positional items', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.tuple([z.string(), z.number()])'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('z.record(z.string(), z.number()) emits object with additionalProperties', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.record(z.string(), z.number())'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'object',
      additionalProperties: { type: 'number' },
    });
  });

  it('z.object({...}).catchall(z.number()) emits typed additionalProperties', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.object({ a: z.string() }).catchall(z.number())'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: { type: 'number' },
    });
  });

  it('z.object({...}).strict() emits additionalProperties=false', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.object({ a: z.string() }).strict()'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('z.object({...}).passthrough() emits permissive additionalProperties (zod v4 emits {} instead of true — semantically identical)', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.object({ a: z.string() }).passthrough()'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: {},
    });
  });

  it('nested z.object schemas preserve structure', async () => {
    const body = await analyzeRequestBody(
      bodySource(
        'z.object({ inner: z.object({ x: z.string(), y: z.number() }) })',
      ),
    );
    assert.deepStrictEqual(body.properties.field, {
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
    const body = await analyzeRequestBody(
      bodySource('z.union([z.string(), z.number()])'),
    );
    const field = body.properties.field;
    const variants = field.anyOf ?? field.oneOf;
    if (variants) {
      const types = variants.map((v: any) => v.type).sort();
      assert.deepStrictEqual(types, ['number', 'string']);
    } else {
      assert.deepStrictEqual([...field.type].sort(), ['number', 'string']);
    }
  });

  it('z.discriminatedUnion emits anyOf of object schemas', async () => {
    const body = await analyzeRequestBody(
      bodySource(
        `z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), x: z.string() }),
          z.object({ kind: z.literal('b'), y: z.number() }),
        ])`,
      ),
    );
    const field = body.properties.field;
    assert.ok(Array.isArray(field.anyOf), 'discriminatedUnion -> anyOf');
    assert.strictEqual(field.anyOf.length, 2);
    assert.strictEqual(field.anyOf[0].properties.kind.const, 'a');
    assert.strictEqual(field.anyOf[1].properties.kind.const, 'b');
  });

  it('z.intersection emits allOf', async () => {
    const body = await analyzeRequestBody(
      bodySource(
        'z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))',
      ),
    );
    const field = body.properties.field;
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
    const body = await analyzeRequestBody(
      bodySource('z.string().optional()'),
    );
    assert.deepStrictEqual(body.properties.field, { type: 'string' });
    assert.ok(
      !(body.required ?? []).includes('field'),
      'field should not be required',
    );
  });

  it('.nullable() emits anyOf with null branch', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.string().nullable()'),
    );
    const field = body.properties.field;
    const hasNull =
      (Array.isArray(field.anyOf) &&
        field.anyOf.some((c: any) => c.type === 'null')) ||
      (Array.isArray(field.oneOf) &&
        field.oneOf.some((c: any) => c.type === 'null')) ||
      (Array.isArray(field.type) && field.type.includes('null'));
    assert.ok(hasNull, 'nullable must include a null branch');
  });

  it('.nullish() makes field optional with null branch', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.string().nullish()'),
    );
    const field = body.properties.field;
    assert.ok(
      !(body.required ?? []).includes('field'),
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
    const body = await analyzeRequestBody(
      bodySource(`z.string().default('hi')`),
    );
    assert.strictEqual(body.properties.field.default, 'hi');
    assert.strictEqual(body.properties.field.type, 'string');
  });

  it('.describe("...") emits description', async () => {
    const body = await analyzeRequestBody(
      bodySource(`z.string().describe('a name')`),
    );
    assert.strictEqual(body.properties.field.description, 'a name');
    assert.strictEqual(body.properties.field.type, 'string');
  });

  it('.refine(...) does not add to the emitted schema (passes through)', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.string().refine((v) => v.length > 0)'),
    );
    assert.deepStrictEqual(body.properties.field, { type: 'string' });
  });

  it('.transform(...) keeps the input schema type (effectStrategy: input)', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.string().transform((v) => v.length)'),
    );
    assert.deepStrictEqual(body.properties.field, { type: 'string' });
  });

  it('.pipe(...) preserves the chained input shape', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.string().pipe(z.string().min(1))'),
    );
    const field = body.properties.field;
    const isAllOf = Array.isArray(field.allOf);
    const isMergedString =
      field.type === 'string' && field.minLength === 1;
    assert.ok(
      isAllOf || isMergedString,
      `pipe should emit allOf or a merged string schema, got ${JSON.stringify(field)}`,
    );
  });

  it('.brand("...") is transparent in the JSON schema', async () => {
    const body = await analyzeRequestBody(
      bodySource(`z.string().brand('UserId')`),
    );
    assert.deepStrictEqual(body.properties.field, { type: 'string' });
  });
});

describe('zod v3 → v4 migration characterization: coerce variants', () => {
  it('z.coerce.string() carries x-zod-type=coerce-string', async () => {
    const body = await analyzeRequestBody(bodySource('z.coerce.string()'));
    assert.strictEqual(body.properties.field.type, 'string');
    assert.strictEqual(
      body.properties.field['x-zod-type'],
      'coerce-string',
    );
  });

  it('z.coerce.boolean() carries x-zod-type=coerce-boolean', async () => {
    const body = await analyzeRequestBody(bodySource('z.coerce.boolean()'));
    assert.strictEqual(body.properties.field.type, 'boolean');
    assert.strictEqual(
      body.properties.field['x-zod-type'],
      'coerce-boolean',
    );
  });

  it('z.coerce.bigint() carries x-zod-type=coerce-bigint', async () => {
    const body = await analyzeRequestBody(bodySource('z.coerce.bigint()'));
    assert.strictEqual(body.properties.field.type, 'integer');
    assert.strictEqual(
      body.properties.field['x-zod-type'],
      'coerce-bigint',
    );
  });
});

describe('zod v3 → v4 migration characterization: recursive (z.lazy)', () => {
  it('inline z.lazy with a non-recursive body resolves to an object schema', async () => {
    const body = await analyzeRequestBody(
      bodySource('z.lazy(() => z.object({ value: z.string() }))'),
    );
    assert.deepStrictEqual(body.properties.field, {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    });
  });

  it('z.lazy referencing an enclosing schema variable throws (analyzer requires self-contained expressions)', async () => {
    const workspace = await tsworkspace(tsconfig, {
      'index.ts': `
import { validate } from 'hono';
import { z } from 'zod';

const app = { post: (path: string, middleware: any, handler: any) => {} };

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
    try {
      await assert.rejects(
        analyze(workspace.tsconfig, {
          responseAnalyzer: responseAnalyzer,
        }),
        /nodeSchema is not defined/,
      );
    } finally {
      await workspace[Symbol.asyncDispose]();
    }
  });
});
