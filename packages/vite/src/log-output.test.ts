import { settleWithin } from '@zukhruf/testing/async';
import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createServer } from 'vite';

import { runNode, workspaceDirectory } from '@sdk-it/testing';
import sdkIt from '@sdk-it/vite';

const spec = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: { '200': { description: 'Pets' } },
      },
    },
  },
});

/** Runs `vite build` with the plugin in a new process with `env`, and returns its stdout. */
async function buildOutput(env: NodeJS.ProcessEnv) {
  await using directory = await workspaceDirectory('vite-log-output-');
  const app = directory.path;
  await writeFile(join(app, 'main.js'), '');
  await writeFile(join(app, 'openapi.json'), spec);
  await writeFile(
    join(app, 'build.mjs'),
    `import { join } from 'node:path';
import { build } from 'vite';
import sdkIt from '@sdk-it/vite';
const root = import.meta.dirname;
await build({
  configFile: false,
  root,
  logLevel: 'silent',
  build: { rollupOptions: { input: join(root, 'main.js') }, write: false },
  plugins: [sdkIt('openapi.json', { name: 'Example', packageName: '@acme/example-client', output: join(root, 'sdk'), cleanup: false, readme: false })],
});
`,
  );
  const { exitCode, stdout, stderr } = await runNode([join(app, 'build.mjs')], {
    env,
  });
  assert.equal(exitCode, 0, stderr);
  return stdout;
}

test('a build logs its progress with a blue SDKIT prefix when colour is forced', async () => {
  const stdout = await buildOutput({ ...process.env, FORCE_COLOR: '1' });

  assert.equal(
    stdout,
    '\u001b[34mSDKIT\u001b[39m: Generating SDK.\n' +
      '\u001b[34mSDKIT\u001b[39m: SDK generated successfully.\n',
  );
});

test('a build logs its progress as plain text when NO_COLOR is set', async () => {
  const { FORCE_COLOR: _forced, ...env } = process.env;

  const stdout = await buildOutput({ ...env, NO_COLOR: '1' });

  assert.equal(
    stdout,
    'SDKIT: Generating SDK.\nSDKIT: SDK generated successfully.\n',
  );
});

test('the dev server logs a failed regeneration with its error to stderr', async (t) => {
  await using workspace = await new TemporaryFiles().directory(
    'vite-log-output-',
  );
  const app = workspace.path;
  const specPath = join(app, 'openapi.json');
  await writeFile(join(app, 'main.js'), '');
  await writeFile(specPath, spec);
  const generated = Promise.withResolvers<void>();
  t.mock.method(console, 'log', (message: unknown) => {
    if (String(message).endsWith('SDK generated successfully.')) {
      generated.resolve();
    }
  });
  const failed = Promise.withResolvers<unknown>();
  t.mock.method(console, 'error', (message: unknown, error: unknown) => {
    if (
      stripVTControlCharacters(String(message)) ===
      'SDKIT: SDK generation failed.'
    ) {
      failed.resolve(error);
    }
  });
  const server = await createServer({
    configFile: false,
    root: app,
    logLevel: 'silent',
    server: { middlewareMode: true },
    plugins: [
      sdkIt('openapi.json', {
        name: 'Example',
        packageName: '@acme/example-client',
        output: join(app, 'sdk'),
        cleanup: false,
        readme: false,
      }),
    ],
  });
  await using _server = { [Symbol.asyncDispose]: () => server.close() };
  await settleWithin(generated.promise, 'initial generation');

  await writeFile(specPath, '{"openapi": ');
  const error = await settleWithin(failed.promise, 'failed regeneration');

  assert.ok(Error.isError(error));
  assert.equal(error.name, 'SyntaxError');
});
