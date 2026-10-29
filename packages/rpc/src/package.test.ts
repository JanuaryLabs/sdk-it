import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

test('the package loads in a project without the TypeScript compiler installed', async () => {
  const withoutTypeScript = `
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript' || specifier.startsWith('typescript/')) {
      throw Object.assign(new Error('Cannot find package typescript'), { code: 'ERR_MODULE_NOT_FOUND' });
    }
    return nextResolve(specifier, context);
  },
});`;

  const { stdout } = await promisify(execFile)(process.execPath, [
    '--import',
    `data:text/javascript,${encodeURIComponent(withoutTypeScript)}`,
    '--input-type=module',
    '--eval',
    "await import('@sdk-it/rpc'); console.log('loaded');",
  ]);

  assert.strictEqual(stdout.trim(), 'loaded');
});
