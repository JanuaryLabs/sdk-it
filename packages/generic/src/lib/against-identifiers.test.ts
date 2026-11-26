import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

const rule =
  'An against may read only z, the import * as <name> namespaces of its route file (such as inputs.*) and the named imports analyze() allows (allowedNamedImports). Write the schema inline.';

void test('an against that reads a named import fails analysis, naming the route, the input, the identifier and the rule', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('against-named-import-', {
    'status.ts': `export const Status = { draft: 'draft', published: 'published' } as const;
`,
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { Status } from './status.ts';

export const app = new Hono();

/** @openapi addPost */
app.post('/posts', validate('application/json', (payload) => ({
  status: { select: payload.body.status, against: z.enum(Status) },
})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const analysis = analyze(project, { responseAnalyzer });

  // Assert
  await assert.rejects(analysis, {
    message: `POST /posts input status: against reads Status, which is neither z nor a namespace it is given. ${rule}\n  at ${workspace.path}/route.ts:10:58`,
  });
});

void test('an against whose callback reads a local function fails analysis', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('against-local-callback-', {
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

const isSlug = (value: string) => /^[a-z-]+$/.test(value);
export const app = new Hono();

/** @openapi addTag */
app.post('/tags', validate('application/json', (payload) => ({
  slug: { select: payload.body.slug, against: z.string().refine((value) => isSlug(value)) },
})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const analysis = analyze(project, { responseAnalyzer });

  // Assert
  await assert.rejects(analysis, {
    message: `POST /tags input slug: against reads isSlug, which is neither z nor a namespace it is given. ${rule}\n  at ${workspace.path}/route.ts:10:76`,
  });
});

void test('an against reads its own callback parameters and JavaScript globals', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('against-globals-', {
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi addEvent */
app.post('/events', validate('application/json', (payload) => ({
  day: { select: payload.body.day, against: z.iso.date().transform((day) => new Date(day)) },
  title: { select: payload.body.title, against: z.coerce.string().transform(String) },
  size: { select: payload.body.size, against: z.number().max(Number.MAX_SAFE_INTEGER) },
})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const { paths } = await analyze(project, { responseAnalyzer });

  // Assert
  const body = paths['/events']?.post?.requestBody;
  assert.ok(body && 'content' in body);
  const schema = body.content['application/json']?.schema;
  assert.ok(schema && 'properties' in schema);
  const { day, ...rest } = schema.properties ?? {};
  assert.partialDeepStrictEqual(day, { type: 'string', format: 'date' });
  assert.deepStrictEqual(rest, {
    size: { type: 'number', maximum: Number.MAX_SAFE_INTEGER },
    title: { type: 'string', 'x-zod-type': 'coerce-string' },
  });
});

void test('an against reads a named import, under its local name, whose export allowedNamedImports names', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('against-allowed-named-', {
    'status.ts': `export const Status = { draft: 'draft', published: 'published' } as const;
`,
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { Status as PostStatus } from './status.ts';

export const app = new Hono();

/** @openapi addPost */
app.post('/posts', validate('application/json', (payload) => ({
  status: { select: payload.body.status, against: z.enum(PostStatus) },
})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const { paths } = await analyze(project, {
    responseAnalyzer,
    allowedNamedImports: ['Status'],
  });

  // Assert
  const body = paths['/posts']?.post?.requestBody;
  assert.ok(body && 'content' in body);
  const schema = body.content['application/json']?.schema;
  assert.ok(schema && 'properties' in schema);
  assert.deepStrictEqual(schema.properties?.['status'], {
    type: 'string',
    enum: ['draft', 'published'],
  });
});

void test('a namespace an against reads that does not load fails analysis with UnloadedImportError, naming the route file and the import', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('against-unloaded-', {
    'node_modules/typed-only/package.json': JSON.stringify({
      name: 'typed-only',
      type: 'module',
      exports: { '.': { types: './index.d.ts', import: './index.js' } },
    }),
    'node_modules/typed-only/index.d.ts': `import { z } from 'zod';
export declare const slug: z.ZodString;
`,
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import * as typed from 'typed-only';

export const app = new Hono();

/** @openapi addPost */
app.post('/posts', validate('application/json', (payload) => ({
  slug: { select: payload.body.slug, against: typed.slug },
})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const analysis = analyze(project, { responseAnalyzer });

  // Assert
  await assert.rejects(analysis, {
    name: 'UnloadedImportError',
    message: `${workspace.path}/route.ts imports * as typed from 'typed-only', which an against reads, but it does not load: Cannot find module '${workspace.path}/node_modules/typed-only/index.js'`,
  });
});
