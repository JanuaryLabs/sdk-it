import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const route = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi updateAgent */
app.post('/agents', validate((payload) => ({
  capabilities: {
    select: payload.body.capabilities,
    against: z.object({
      skills: z.record(z.string(), z.object({ enabled: z.boolean() })),
    }),
  },
})), (c) => {
  return c.json({ ok: true });
});
`;

function workspace() {
  return analysisWorkspace('record-validator-', { 'route.ts': route });
}

describe('z.record inside a validator body', () => {
  test('generated client accepts a skills map and rejects a single { enabled } object', async () => {
    await using dir = await workspace();
    using project = openAnalysisProject(dir.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const output = join(dir.path, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Agents', version: '1.0.0' },
        paths: spec.paths,
        components: spec.components,
      },
      {
        output,
        name: 'Agents',
        packageName: '@acme/sdk',
        readme: false,
        mode: 'full',
      },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { createAgents } from './index.ts';
const client = createAgents({ baseUrl: 'https://example.test' });
await client.request('POST /agents', {
  capabilities: {
    skills: { search: { enabled: true }, web: { enabled: false } },
  },
});
await client.request('POST /agents', {
  capabilities: {
    // @ts-expect-error skills maps a skill name to its settings.
    skills: { enabled: true },
  },
});
`,
    );

    const { files, diagnostics } = typecheck(configPath);

    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });
});
