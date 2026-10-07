import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

test('generated comparison clients preserve guarded response fields and optional siblings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-narrowed-response-'));
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
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

interface Run { id: string }
const runs = new Map<string, Run>([
  ['baseline', { id: 'baseline' }],
  ['candidate', { id: 'candidate' }],
]);
export const app = new Hono();

/**
 * @openapi compareRuns
 * @tags compare
 */
app.get('/compare', validate((payload) => ({
  baseline: { select: payload.query.baseline, against: z.string() },
  candidate: { select: payload.query.candidate, against: z.string() },
})), (c) => {
  const { baseline, candidate } = c.var.input;
  const baselineRun = runs.get(baseline);
  const candidateRun: Run | undefined = runs.get(candidate);
  const optionalRun: Run | undefined = runs.get('missing');
  if (!baselineRun || !candidateRun) {
    throw new HTTPException(404, { message: 'One or both runs not found' });
  }
  return c.json({
    baseline: baselineRun,
    candidate: candidateRun,
    optional: optionalRun,
    result: { equal: baselineRun.id === candidateRun.id },
  });
});
`,
    );
    const { app } = (await import(
      pathToFileURL(join(dir, 'route.ts')).href
    )) as { app: Hono };
    const response = await app.request(
      '/compare?baseline=baseline&candidate=candidate',
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      baseline: { id: 'baseline' },
      candidate: { id: 'candidate' },
      result: { equal: false },
    });
    assert.equal(
      (await app.request('/compare?baseline=missing&candidate=candidate'))
        .status,
      404,
    );

    const spec = await analyze(join(dir, 'tsconfig.json'), {
      responseAnalyzer,
    });
    const output = join(dir, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Comparison', version: '1.0.0' },
        paths: spec.paths,
        components: spec.components,
      },
      { output, name: 'Comparison', readme: false, mode: 'full' },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { Comparison } from './index.ts';
const client = new Comparison({ baseUrl: 'https://example.test' });
const value = await client.request('GET /compare', {
  baseline: 'baseline', candidate: 'candidate',
});
const baselineId: string = value.baseline.id;
const candidateId: string = value.candidate.id;
const optionalId: string | undefined = value.optional?.id;
// @ts-expect-error The unguarded sibling remains optional.
const unguardedOptionalId: string = value.optional.id;
void [baselineId, candidateId, optionalId, unguardedOptionalId];
`,
    );
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(configFile.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      output,
    );
    assert.deepEqual(parsed.errors, []);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    assert.ok(program.getSourceFile(consumerPath));
    assert.deepEqual(
      ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
        file: diagnostic.file?.fileName,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      })),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
