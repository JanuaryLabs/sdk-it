import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

test('OpenAPI stringbool body inputs match the JSON accepted by the route', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-stringbool-input-'));
  try {
    const require = createRequire(import.meta.url);
    await symlink(
      dirname(dirname(require.resolve('zod/package.json'))),
      join(dir, 'node_modules'),
      'dir',
    );
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
        },
        include: ['route.ts'],
      }),
    );
    await writeFile(
      join(dir, 'route.ts'),
      `import { Hono } from 'hono';
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
    );

    const { app } = (await import(
      pathToFileURL(join(dir, 'route.ts')).href
    )) as {
      app: Hono;
    };
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

    const spec = await analyze(join(dir, 'tsconfig.json'), {
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
