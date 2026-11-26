import { describe, test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, parseErrorFor, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const route = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi pair */
app.post('/pairs', validate((payload) => ({
  pair: { select: payload.body.pair, against: z.tuple([z.string(), z.number()]) },
  head: { select: payload.body.head, against: z.tuple([z.string()], z.number()) },
})), (c) => c.body(null, 204));
`;

type Workspace = Awaited<ReturnType<typeof analysisWorkspace>>;

async function analyzed(workspace: Workspace) {
  using project = openAnalysisProject(workspace.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  return {
    openapi: '3.1.0',
    info: { title: 'Pairs', version: '1.0.0' },
    servers: [{ url: 'https://api.test' }],
    paths: spec.paths,
    components: spec.components,
  };
}

async function generated(workspace: Workspace) {
  const output = join(workspace.path, 'client');
  await generate(await analyzed(workspace), {
    output,
    name: 'Pairs',
    packageName: '@acme/pairs',
    readme: false,
    mode: 'full',
  });
  return output;
}

describe('a z.tuple against', () => {
  test('the generated client accepts the arrays the tuple allows', async () => {
    // Arrange
    await using workspace = await analysisWorkspace('tuple-against-runtime-', {
      'route.ts': route,
    });
    const output = await generated(workspace);
    const { createPairs } = await import(
      pathToFileURL(join(output, 'src/index.ts')).href
    );
    const client = createPairs({
      baseUrl: 'https://api.test',
      fetch: async () => new Response(null, { status: 204 }),
    });
    const valid = { pair: ['a', 1], head: ['a', 1, 2] };

    // Act and assert
    await assert.doesNotReject(client.request('POST /pairs', valid));
    await assert.doesNotReject(
      client.request('POST /pairs', { ...valid, head: ['a'] }),
    );
  });

  void test.each(
    [
      ['pair', ['a']],
      ['pair', ['a', 1, 2]],
      ['pair', [1, 'a']],
      ['head', []],
      ['head', ['a', 'b']],
    ] as const,
    ([field, wrong]) =>
      test(`the generated client refuses ${field} ${JSON.stringify(wrong)}`, async () => {
        // Arrange
        await using workspace = await analysisWorkspace(
          'tuple-against-runtime-',
          { 'route.ts': route },
        );
        const output = await generated(workspace);
        const { createPairs } = await import(
          pathToFileURL(join(output, 'src/index.ts')).href
        );
        const client = createPairs({
          baseUrl: 'https://api.test',
          fetch: async () => new Response(null, { status: 204 }),
        });
        const valid = { pair: ['a', 1], head: ['a', 1, 2] };

        // Act and assert
        await assert.rejects(
          client.request('POST /pairs', { ...valid, [field]: wrong }),
          parseErrorFor(field),
          `${field}: ${JSON.stringify(wrong)}`,
        );
      }),
  );

  test('the generated client types the tuple by its elements and its rest', async () => {
    // Arrange
    await using workspace = await analysisWorkspace('tuple-against-type-', {
      'route.ts': route,
    });
    const output = await generated(workspace);
    const consumer = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumer,
      [
        "import type { PairsEndpoints } from './index.ts';",
        "type Input = PairsEndpoints['POST /pairs']['input'];",
        "const pair: Input['pair'] = ['a', 1];",
        '// @ts-expect-error a pair has two elements',
        "const long: Input['pair'] = ['a', 1, 2];",
        "const head: Input['head'] = ['a', 1, 2];",
        '// @ts-expect-error the rest are numbers',
        "const badRest: Input['head'] = ['a', 'b'];",
        'export { pair, long, head, badRest };',
        '',
      ].join('\n'),
    );

    // Act
    const { files, diagnostics } = typecheck(join(output, 'tsconfig.json'));

    // Assert
    assert.ok(files.includes(consumer));
    assert.deepEqual(diagnostics, []);
  });
});
