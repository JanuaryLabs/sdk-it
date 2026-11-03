import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

test('OpenAPI stringbool body inputs match the JSON accepted by the route', async () => {
  await using workspace = await analysisWorkspace('stringbool-input-', {
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi updateSettings */
app.post('/settings', validate((payload) => ({
  active: { select: payload.body.active, against: z.stringbool() },
})), (c) => {
  return c.json({ active: c.get('input').active });
});
`,
  });

  const { app }: { app: Hono } = await import(
    pathToFileURL(join(workspace.path, 'route.ts')).href
  );
  for (const [active, expected] of [
    ['true', true],
    ['false', false],
  ] as const) {
    const response = await app.request('/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { active: expected });
  }
  for (const active of [true, false]) {
    const response = await app.request('/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    assert.equal(response.status, 400);
  }

  using project = openAnalysisProject(workspace.tsconfig);
  const spec = await analyze(project, {
    responseAnalyzer,
  });
  const requestBody = spec.paths['/settings']?.post?.requestBody;
  assert.ok(requestBody && 'content' in requestBody);
  const bodySchema = requestBody.content['application/json']?.schema;
  assert.ok(bodySchema && 'properties' in bodySchema);
  const active = bodySchema.properties?.active;
  assert.ok(active && 'type' in active);
  assert.equal(active.type, 'string');
  assert.deepEqual(bodySchema.required, ['active']);
});
