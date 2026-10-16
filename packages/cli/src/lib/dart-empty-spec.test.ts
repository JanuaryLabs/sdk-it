import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtempDisposable,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import manifest from '@sdk-it/cli/package.json' with { type: 'json' };

void test.each(['new', 'nested', 'existing'] as const, (directory) =>
  test(`Dart CLI generates and formats an empty SDK with ${directory} output directory`, async () => {
    await using workspace = await mkdtempDisposable(
      join(tmpdir(), 'sdk-it-cli-dart-empty-'),
    );
    const spec = join(workspace.path, 'openapi.json');
    const output = join(
      workspace.path,
      directory === 'nested' ? 'generated/clients/dart' : 'client',
    );
    if (directory === 'existing') await mkdir(output);
    await writeFile(
      spec,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: {},
      }),
    );
    const formatter = join(workspace.path, 'formatter.mjs');
    await writeFile(
      formatter,
      `
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const client = await readFile(join(process.env.SDK_IT_OUTPUT, 'package.dart'), 'utf8');
await writeFile(join(process.env.SDK_IT_OUTPUT, 'formatted.txt'), client);
`,
    );

    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            manifest.bin['sdk-it'],
            import.meta.resolve('@sdk-it/cli/package.json'),
          ),
        ),
        'generate',
        'dart',
        '--spec',
        spec,
        '--output',
        output,
        '--formatter',
        `${process.execPath} ${formatter}`,
      ],
      { cwd: workspace.path, encoding: 'utf8', timeout: 30_000 },
    );

    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      await readFile(join(output, 'lib', 'formatted.txt'), 'utf8'),
      /class Client/,
    );
    assert.match(
      await readFile(join(output, 'pubspec.yaml'), 'utf8'),
      /name: client_sdk/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(output, 'openapi.json'), 'utf8')).paths,
      {},
    );
  }),
);
