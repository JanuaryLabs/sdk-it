import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { typecheck } from '@sdk-it/testing';
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

async function workspace() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-record-validator-')),
  );
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
  await writeFile(join(dir, 'route.ts'), route);
  return dir;
}

describe('z.record inside a validator body', () => {
  test('generated client accepts a skills map and rejects a single { enabled } object', async () => {
    const dir = await workspace();
    try {
      using project = openAnalysisProject(join(dir, 'tsconfig.json'));
      const spec = await analyze(project, { responseAnalyzer });
      const output = join(dir, 'client');
      await generate(
        {
          openapi: '3.1.0',
          info: { title: 'Agents', version: '1.0.0' },
          paths: spec.paths,
          components: spec.components,
        },
        { output, name: 'Agents', readme: false, mode: 'full' },
      );
      const configPath = join(output, 'tsconfig.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.compilerOptions.strict = true;
      await writeFile(configPath, JSON.stringify(config));
      const consumerPath = join(output, 'src', 'consumer.ts');
      await writeFile(
        consumerPath,
        `import { Agents } from './index.ts';
const client = new Agents({ baseUrl: 'https://example.test' });
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
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
