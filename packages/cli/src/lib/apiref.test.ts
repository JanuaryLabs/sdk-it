import { TemporaryFiles } from '@zukhruf/testing/fs';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import manifest from '@sdk-it/cli/package.json' with { type: 'json' };

const bin = fileURLToPath(
  new URL(
    manifest.bin['sdk-it'],
    import.meta.resolve('@sdk-it/cli/package.json'),
  ),
);

// The API reference build is a full Vite build of @sdk-it/apiref. `nx` is the
// external command the CLI starts, so each test puts its own `nx` first on
// PATH (and nothing else, so the real one can never run).
async function apiref(
  workspace: string,
  nx: string,
  {
    spec = join(workspace, 'openapi.json'),
    output = join(workspace, 'reference'),
  } = {},
) {
  await writeFile(join(workspace, 'nx'), `#!${process.execPath}\n${nx}`, {
    mode: 0o755,
  });
  return spawnSync(
    process.execPath,
    [bin, 'generate', 'apiref', '--spec', spec, '--output', output],
    {
      cwd: workspace,
      env: { PATH: workspace, SDK_IT_CALLER: 'kept' },
      encoding: 'utf8',
    },
  );
}

const recordsSpecAndOutput = (workspace: string) =>
  `require('node:fs').writeFileSync(${JSON.stringify(join(workspace, 'started.json'))}, JSON.stringify({
  spec: process.env.VITE_SPEC,
  output: process.env.VITE_SDK_IT_OUTPUT,
}));`;

void test('a relative spec and output are taken from the folder sdk-it apiref runs in', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-apiref-',
  );

  const result = await apiref(
    workspace.path,
    recordsSpecAndOutput(workspace.path),
    {
      spec: 'openapi.json',
      output: 'reference',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(await readFile(join(workspace.path, 'started.json'), 'utf8')),
    {
      spec: join(workspace.path, 'openapi.json'),
      output: join(workspace.path, 'reference'),
    },
  );
});

void test('a spec URL reaches the apiref build unchanged', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-apiref-',
  );

  const result = await apiref(
    workspace.path,
    recordsSpecAndOutput(workspace.path),
    {
      spec: 'https://api.example.com/openapi.json',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(await readFile(join(workspace.path, 'started.json'), 'utf8'))
      .spec,
    'https://api.example.com/openapi.json',
  );
});

void test('a failed apiref build makes sdk-it apiref fail', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-apiref-',
  );

  const result = await apiref(
    workspace.path,
    `console.error('vite build failed'); process.exitCode = 3;`,
  );

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /vite build failed/);
});

void test('the apiref build’s own output reaches the sdk-it apiref output', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-apiref-',
  );

  const result = await apiref(
    workspace.path,
    `console.log('✓ built in 4.2s');`,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /✓ built in 4\.2s/);
});

void test('sdk-it apiref starts the apiref build in the apiref package, with the spec, the output and the caller’s environment', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-apiref-',
  );

  const result = await apiref(
    workspace.path,
    `require('node:fs').writeFileSync(${JSON.stringify(join(workspace.path, 'started.json'))}, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  spec: process.env.VITE_SPEC,
  output: process.env.VITE_SDK_IT_OUTPUT,
  caller: process.env.SDK_IT_CALLER,
}));`,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(await readFile(join(workspace.path, 'started.json'), 'utf8')),
    {
      args: ['run', 'apiref:build', '--verbose'],
      cwd: await realpath(
        fileURLToPath(
          new URL('.', import.meta.resolve('@sdk-it/apiref/package.json')),
        ),
      ),
      spec: join(workspace.path, 'openapi.json'),
      output: join(workspace.path, 'reference'),
      caller: 'kept',
    },
  );
});
