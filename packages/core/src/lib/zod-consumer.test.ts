import { TemporaryFiles } from '@zukhruf/fs';
import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ZodEvaluator } from '@sdk-it/core';

test('Zod consumers receive an explicit version contract', async () => {
  const coreManifest = findPackageJSON('@sdk-it/core', import.meta.url);
  const zodManifest = findPackageJSON('zod', import.meta.url);
  assert.ok(coreManifest && zodManifest, '@sdk-it/core and zod resolve');
  const coreRoot = dirname(coreManifest);
  const zodRoot = dirname(zodManifest);
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-zod-consumer-',
  );
  const dir = workspace.path;
  // These are real published runtimes: Zod ships the v3 implementation as a
  // self-contained public subpackage. Copy it as the consumer's resolved zod.
  for (const major of [3, 4]) {
    const consumer = join(dir, `v${major}`);
    const core = join(consumer, 'node_modules/@sdk-it/core');
    await mkdir(core, { recursive: true });
    await cp(join(coreRoot, 'package.json'), join(core, 'package.json'));
    await cp(join(coreRoot, 'dist'), join(core, 'dist'), { recursive: true });
    await cp(
      major === 3 ? join(zodRoot, 'v3') : zodRoot,
      join(consumer, 'node_modules/zod'),
      { recursive: true },
    );
    const isolated: { ZodEvaluator: typeof ZodEvaluator } = await import(
      pathToFileURL(join(core, 'dist/lib/zod-jsonschema.js')).href
    );
    using evaluator = new isolated.ZodEvaluator({ conditions: [] });
    if (major === 3) {
      await assert.rejects(
        evaluator.evaluate('z.string()'),
        /@sdk-it\/core requires Zod 4/,
      );
      continue;
    }
    assert.equal(
      (await evaluator.evaluate('z.string()')).schema.type,
      'string',
    );
    await cp(zodRoot, join(consumer, 'node_modules/consumer-zod'), {
      recursive: true,
    });
    const imported = await evaluator.evaluate('consumer.string()', [
      {
        import: 'consumer',
        from: await evaluator.resolve(
          'consumer-zod',
          pathToFileURL(join(consumer, 'consumer.js')).href,
        ),
      },
    ]);
    assert.equal(imported.schema.type, 'string');
  }

  const manifest = JSON.parse(
    await readFile(join(coreRoot, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.peerDependencies.zod, '^4.6.7');
});

void test.each(
  [
    'legacy.string()',
    'z.object({ name: legacy.string() })',
    'z.array(legacy.string())',
    'z.lazy(() => legacy.string())',
    'z.union([z.string(), legacy.number()])',
  ],
  (schema) =>
    test(`a Zod 3 schema gets an incompatible-schema diagnostic (${schema})`, async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      await assert.rejects(
        evaluator.evaluate(schema, [
          { import: 'legacy', from: import.meta.resolve('zod/v3') },
        ]),
        /@sdk-it\/core requires Zod 4 schemas.*migrate.*Zod 3/,
      );
    }),
);
