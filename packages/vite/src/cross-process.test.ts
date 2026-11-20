import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { runNode, workspaceDirectory } from '@sdk-it/testing';

const spec = {
  openapi: '3.1.0',
  info: { title: 'Example', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: { '204': { description: 'No pets' } },
      },
    },
  },
};

const buildScript = `
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { build } from 'vite';
import sdkIt from '@sdk-it/vite';

const [output, log, name] = process.argv.slice(2);
const root = import.meta.dirname;
await build({
  configFile: false,
  root,
  logLevel: 'silent',
  build: { rollupOptions: { input: join(root, 'main.js') }, write: false },
  plugins: [
    sdkIt.file('openapi.json', {
      name: 'Example',
      packageName: '@acme/example-client',
      output,
      readme: false,
      async formatCode() {
        await appendFile(log, 'start ' + name + '\\n');
        await setTimeout(500);
        await appendFile(log, 'end ' + name + '\\n');
      },
    }),
  ],
});
`;

test('two processes that build into one SDK folder at once generate one after the other', async () => {
  await using app = await workspaceDirectory('vite-cross-process-');
  await writeFile(join(app.path, 'main.js'), '');
  await writeFile(join(app.path, 'openapi.json'), JSON.stringify(spec));
  await writeFile(join(app.path, 'build.mjs'), buildScript);
  const output = join(app.path, 'sdk');
  const log = join(app.path, 'generations.log');
  await writeFile(log, '');

  const runs = await Promise.all(
    ['a', 'b'].map((name) =>
      runNode([join(app.path, 'build.mjs'), output, log, name]),
    ),
  );

  for (const { exitCode, stderr } of runs) assert.equal(exitCode, 0, stderr);
  const [first, firstEnd, second, secondEnd] = (await readFile(log, 'utf8'))
    .trim()
    .split('\n');
  assert.equal(firstEnd, first?.replace('start', 'end'));
  assert.equal(secondEnd, second?.replace('start', 'end'));
  assert.notEqual(first, second);
});
