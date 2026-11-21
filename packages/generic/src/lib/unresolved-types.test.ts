import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

void test('a response typed by a client whose generated module is missing fails analysis, naming the route and the module', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('unresolved-type-', {
    'db.ts': `export * from './prisma/client.ts';
`,
    'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { type PrismaClient } from './db.ts';

declare const prisma: PrismaClient;
export const app = new Hono();

/** @openapi listPatients */
app.get('/patients', validate(() => ({})), async (c) => {
  const patients = await prisma.patient.findMany();
  return c.json({ patients });
});
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const analysis = analyze(project, { responseAnalyzer });

  // Assert
  await assert.rejects(analysis, (error: Error) => {
    assert.match(
      error.message,
      /^GET \/patients: the response at .*route\.ts:11:17 has a type that does not resolve/,
    );
    assert.match(
      error.message,
      /db\.ts\(1,15\): error TS2307: Cannot find module '\.\/prisma\/client\.ts'/,
    );
    assert.match(
      error.message,
      /route\.ts\(3,15\): error TS2305: Module '"\.\/db\.ts"' has no exported member 'PrismaClient'/,
    );
    return true;
  });
});

void test('a response that is any or unknown is documented as any value', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('any-response-', {
    'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi readSettings */
app.get('/settings', validate(() => ({})), (c) => {
  const stored: any = JSON.parse('{}');
  const extra: unknown = stored.extra;
  return c.json({ stored, extra });
});

/** @openapi readRaw */
app.get('/raw', validate(() => ({})), (c) => {
  const raw: any = JSON.parse('{}');
  return c.json(raw);
});
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const { paths } = await analyze(project, { responseAnalyzer });

  // Assert
  const ok = paths['/settings']?.get?.responses?.['200'];
  assert.deepStrictEqual(ok?.content?.['application/json']?.schema, {
    type: 'object',
    properties: { extra: {}, stored: {} },
    required: ['extra', 'stored'],
    additionalProperties: false,
  });
  const raw = paths['/raw']?.get?.responses?.['200'];
  assert.deepStrictEqual(raw?.content?.['application/json']?.schema, {});
});

void test('an import that does not resolve outside every response leaves analysis to succeed', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('unresolved-elsewhere-', {
    'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { audit } from './missing-audit.ts';

export const app = new Hono();

/** @openapi ping */
app.get('/ping', validate(() => ({})), (c) => {
  audit('ping');
  return c.json({ ok: true });
});
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);

  // Act
  const { paths } = await analyze(project, { responseAnalyzer });

  // Assert
  const ok = paths['/ping']?.get?.responses?.['200'];
  assert.deepStrictEqual(ok?.content?.['application/json']?.schema, {
    type: 'object',
    properties: { ok: { type: 'boolean', enum: [true] } },
    required: ['ok'],
    additionalProperties: false,
  });
});
