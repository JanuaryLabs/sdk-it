import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

function route(importLine: string, against: string) {
  return `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
${importLine}

export const app = new Hono();

/** @openapi addPost */
app.post('/posts', validate('application/json', (payload) => ({
  slug: { select: payload.body.slug, against: ${against} },
})), (c) => c.json({ ok: true }));
`;
}

async function slugSchema(tsconfig: string) {
  using project = openAnalysisProject(tsconfig);
  const { paths } = await analyze(project, { responseAnalyzer });
  const body = paths['/posts']?.post?.requestBody;
  assert.ok(body && 'content' in body);
  const schema = body.content['application/json']?.schema;
  assert.ok(schema && 'properties' in schema);
  return schema.properties?.['slug'];
}

void test('an against reads a namespace from an ESM-only package that exports only import and types', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('against-esm-only-', {
    'node_modules/esm-only/package.json': JSON.stringify({
      name: 'esm-only',
      type: 'module',
      exports: { '.': { types: './index.d.ts', import: './index.js' } },
    }),
    'node_modules/esm-only/index.js': `import { z } from 'zod';
export const slug = z.string().regex(/^[a-z]+$/);
`,
    'node_modules/esm-only/index.d.ts': `import { z } from 'zod';
export declare const slug: z.ZodString;
`,
    'route.ts': route(`import * as esm from 'esm-only';`, 'esm.slug'),
  });

  // Act
  const slug = await slugSchema(workspace.tsconfig);

  // Assert
  assert.deepStrictEqual(slug, { type: 'string', pattern: '^[a-z]+$' });
});

void test('an against reads a workspace package from source through the tsconfig customConditions, whose source imports another workspace package that has no build', async () => {
  // Arrange
  const manifest = (name: string) =>
    JSON.stringify({
      name,
      type: 'module',
      exports: {
        '.': {
          '@acme/source': './src/index.ts',
          types: './dist/index.d.ts',
          import: './dist/index.js',
        },
      },
    });
  await using workspace = await analysisWorkspace(
    'against-source-condition-',
    {
      'packages/inputs/package.json': manifest('@acme/inputs'),
      'packages/inputs/src/index.ts': `import { word } from '@acme/words';
export const slug = word.max(20);
`,
      'packages/words/package.json': manifest('@acme/words'),
      'packages/words/src/index.ts': `import { z } from 'zod';
export const word = z.string().min(2);
`,
      'route.ts': route(
        `import * as inputs from '@acme/inputs';`,
        'inputs.slug',
      ),
    },
    { customConditions: ['@acme/source'] },
  );
  await mkdir(join(workspace.path, 'node_modules/@acme'), { recursive: true });
  for (const name of ['inputs', 'words']) {
    await symlink(
      join(workspace.path, 'packages', name),
      join(workspace.path, 'node_modules/@acme', name),
    );
  }

  // Act
  const slug = await slugSchema(workspace.tsconfig);

  // Assert
  assert.deepStrictEqual(slug, { type: 'string', minLength: 2, maxLength: 20 });
});

void test('an against reads a relative TypeScript namespace and a node_modules namespace', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('against-relative-', {
    'node_modules/dual/package.json': JSON.stringify({
      name: 'dual',
      type: 'module',
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
    }),
    'node_modules/dual/index.js': `import { z } from 'zod';
export const suffix = z.string().endsWith('-post');
`,
    'node_modules/dual/index.d.ts': `import { z } from 'zod';
export declare const suffix: z.ZodString;
`,
    'inputs.ts': `import { z } from 'zod';
export const slug = z.string().min(3) as z.ZodString;
`,
    'route.ts': route(
      `import * as inputs from './inputs';\nimport * as dual from 'dual';`,
      'inputs.slug.and(dual.suffix)',
    ),
  });

  // Act
  const slug = await slugSchema(workspace.tsconfig);

  // Assert
  assert.deepStrictEqual(slug, {
    allOf: [
      { type: 'string', minLength: 3 },
      { type: 'string', format: 'ends_with', pattern: '.*-post$' },
    ],
  });
});
