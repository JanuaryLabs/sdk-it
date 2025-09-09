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

  it.only('should handle multiple HTTP methods and content types', async () => {
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

		console.dir(result.paths['/items']?.get?.parameters?.[0], { depth: null });

    assert.strictEqual(
      Object.keys(result.paths).length,
      1,
      'Should have one path',
    );
  });
});
