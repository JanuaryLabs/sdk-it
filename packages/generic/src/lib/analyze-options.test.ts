import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

test('analyze() refuses an option it does not take, naming it, so a JavaScript caller of a removed option fails instead of getting a different document', async () => {
  await using workspace = await analysisWorkspace('analyze-options-', {
    'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
/** @openapi getHealth */
app.get('/health', validate(() => ({})), (c) => c.json({ ok: true }));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  // A JavaScript caller has no type check: these are options analyze() took before.
  for (const removed of ['typesMap', 'onOperation', 'securitySchemes']) {
    const options: Parameters<typeof analyze>[1] = { responseAnalyzer };
    Reflect.set(options, removed, {});
    await assert.rejects(analyze(project, options), {
      name: 'TypeError',
      message: new RegExp(`analyze\\(\\) takes no option '${removed}'`),
    });
  }
});
