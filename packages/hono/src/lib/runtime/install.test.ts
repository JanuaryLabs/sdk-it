import { notInstalled } from '@zukhruf/testing/preload';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { test } from 'node:test';

test('@sdk-it/hono/runtime does not require compiler dependencies', async () => {
  const manifest = (packageName: string) => {
    const path = findPackageJSON(packageName, import.meta.url);
    assert.ok(path, `${packageName} resolves from this test`);
    return JSON.parse(readFileSync(path, 'utf8'));
  };

  assert.equal(
    typeof (await import('@sdk-it/hono/runtime')).validate,
    'function',
  );
  assert.equal(
    manifest('@sdk-it/hono').peerDependenciesMeta['@typescript/native']
      .optional,
    true,
  );
  const core = manifest('@sdk-it/core');
  assert.equal(core.peerDependenciesMeta['@typescript/native'].optional, true);
  assert.equal(core.peerDependenciesMeta['openapi3-ts'].optional, true);
});

test('@sdk-it/hono/runtime and @sdk-it/core load without the TypeScript compiler', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      notInstalled('typescript', '@typescript/native'),
      '--input-type=module',
      '-e',
      "await import('@sdk-it/hono/runtime'); await import('@sdk-it/core');",
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
});
