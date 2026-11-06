import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';

import { analysisWorkspace } from '@sdk-it/testing';

/** Runs `analyze()` on a one-file app in a new process with `env`, and returns the app's index.ts and the stderr. */
async function analyzeIn(env: NodeJS.ProcessEnv) {
  await using dir = await analysisWorkspace('analysis-trace-', {
    'index.ts': `import { Hono } from 'hono';
export const app = new Hono();
/** @openapi listPets */
app.get('/pets', (c) => c.json([{ name: 'Rex' }]));
`,
    'analyze.mjs': `import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
using project = openAnalysisProject(process.argv[2]);
await analyze(project, { responseAnalyzer });
`,
  });
  const child = spawn(
    process.execPath,
    [join(dir.path, 'analyze.mjs'), dir.tsconfig],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stderr = text(child.stderr);
  const stdout = text(child.stdout);
  const [exitCode] = await once(child, 'close');
  assert.equal(exitCode, 0, `${await stdout}${await stderr}`);
  return { index: join(dir.path, 'index.ts'), stderr: await stderr };
}

test('analyze traces each visited source file to stderr when NODE_DEBUG names @sdk-it/generic', async () => {
  const { index, stderr } = await analyzeIn({
    ...process.env,
    NODE_DEBUG: '@sdk-it/generic',
  });

  assert.ok(stderr.includes(`Visiting ${index}\n`), stderr);
});

test('analyze prints no trace without NODE_DEBUG', async () => {
  const { NODE_DEBUG: _debug, ...env } = process.env;

  const { stderr } = await analyzeIn(env);

  assert.ok(!stderr.includes('Visiting'), stderr);
});
