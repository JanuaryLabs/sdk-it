import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { evalZod } from '@sdk-it/core';

test('Zod consumers receive an explicit version contract and incompatible-schema diagnostics', async () => {
  const require = createRequire(import.meta.url);
  const coreRoot = dirname(require.resolve('@sdk-it/core/package.json'));
  const zodRoot = dirname(require.resolve('zod/package.json'));
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-zod-consumer-'));
  try {
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
      const consumerRequire = createRequire(join(consumer, 'consumer.cjs'));
      const isolated = (await import(
        pathToFileURL(consumerRequire.resolve('@sdk-it/core/zod-jsonschema.js'))
          .href
      )) as { evalZod: typeof evalZod };
      if (major === 3) {
        await assert.rejects(
          isolated.evalZod('z.string()'),
          /@sdk-it\/core requires Zod 4/,
        );
        continue;
      }
      assert.equal(
        (await isolated.evalZod('z.string()')).schema.type,
        'string',
      );
      await cp(zodRoot, join(consumer, 'node_modules/consumer-zod'), {
        recursive: true,
      });
      const imported = await isolated.evalZod('consumer.string()', [
        {
          import: 'consumer',
          from: consumerRequire.resolve('consumer-zod'),
        },
      ]);
      assert.equal(imported.schema.type, 'string');
    }

    for (const schema of [
      'legacy.string()',
      'z.object({ name: legacy.string() })',
      'z.array(legacy.string())',
      'z.lazy(() => legacy.string())',
      'z.union([z.string(), legacy.number()])',
    ]) {
      await assert.rejects(
        evalZod(schema, [
          {
            import: 'legacy',
            from: require.resolve('zod/v3'),
          },
        ]),
        /@sdk-it\/core requires Zod 4 schemas.*migrate.*Zod 3/,
      );
    }
    const manifest = JSON.parse(
      await readFile(join(coreRoot, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.peerDependencies.zod, '^4.3.0');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
