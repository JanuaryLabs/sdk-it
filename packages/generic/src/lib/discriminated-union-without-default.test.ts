import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, parseErrorFor } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('a discriminated union validated by a Hono route refuses an input without its discriminator', async () => {
  await using workspace = await analysisWorkspace('const-no-default-', {
    'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { z } from 'zod';

export const app = new Hono();

/** @openapi recordIntake */
app.post(
  '/patients',
  validate('application/json', (payload) => ({
    medications: {
      select: payload.body.medications,
      against: z.discriminatedUnion('answer', [
        z.object({ answer: z.literal('none') }),
        z.object({ answer: z.literal('yes'), entries: z.array(z.string()).min(1) }),
        z.object({ answer: z.literal('skip') }),
      ]),
    },
  })),
  (c) => c.body(null, 204),
);
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  const output = join(workspace.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Patients', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    {
      output,
      name: 'Patients',
      packageName: '@acme/patients',
      readme: false,
      mode: 'full',
    },
  );
  const { createPatients } = await import(
    pathToFileURL(join(output, 'src/index.ts')).href
  );
  const client = createPatients({
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });

  await assert.rejects(
    client.request('POST /patients', { medications: {} }),
    parseErrorFor('medications'),
  );
  await assert.doesNotReject(
    client.request('POST /patients', { medications: { answer: 'none' } }),
  );
});
