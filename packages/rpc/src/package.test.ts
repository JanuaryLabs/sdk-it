import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

test('the published package declares the Node requirement of AI SDK 7', () => {
  const manifest = require('@sdk-it/rpc/package.json') as {
    engines?: { node?: string };
  };

  assert.strictEqual(manifest.engines?.node, '>=22');
});
