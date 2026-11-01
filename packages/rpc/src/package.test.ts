import { notInstalled } from '@zukhruf/testing/preload';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

test('the package loads in a project without the TypeScript compiler installed', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--import',
    notInstalled('typescript'),
    '--input-type=module',
    '--eval',
    "await import('@sdk-it/rpc'); console.log('loaded');",
  ]);

  assert.strictEqual(stdout.trim(), 'loaded');
});
