import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
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
});
