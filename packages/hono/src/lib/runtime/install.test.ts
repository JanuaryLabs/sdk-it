import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

test('@sdk-it/hono/runtime does not require compiler dependencies', async () => {
  const manifest = (packageName: string) =>
    JSON.parse(
      readFileSync(require.resolve(`${packageName}/package.json`), 'utf8'),
    );

  assert.equal(
    typeof (await import('@sdk-it/hono/runtime')).validate,
    'function',
  );
  assert.equal(
    manifest('@sdk-it/hono').peerDependenciesMeta.typescript.optional,
    true,
  );
  const core = manifest('@sdk-it/core');
  assert.equal(core.peerDependenciesMeta.typescript.optional, true);
  assert.equal(core.peerDependenciesMeta['openapi3-ts'].optional, true);
});
