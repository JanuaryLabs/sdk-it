import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtempDisposable,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generate } from '@sdk-it/dart';

void test.each(['new', 'nested', 'existing'] as const, (directory) =>
  test(`generates an empty Dart SDK with ${directory} output directory`, async () => {
    await using workspace = await mkdtempDisposable(
      join(tmpdir(), 'sdk-it-dart-empty-'),
    );
    const output = join(
      workspace.path,
      directory === 'nested' ? 'generated/clients/dart' : 'client',
    );
    if (directory === 'existing') {
      await mkdir(output);
      await writeFile(join(output, 'pubspec.yaml'), 'name: existing_sdk\n');
      await writeFile(join(output, 'readme.md'), 'My SDK documentation');
    }

    let formattedOutput: string | undefined;
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: {},
      },
      {
        output,
        formatCode: async ({ output }) => {
          assert.match(
            await readFile(join(output, 'package.dart'), 'utf8'),
            /class Client/,
          );
          formattedOutput = output;
        },
      },
    );

    assert.equal(formattedOutput, join(output, 'lib'));
    assert.deepEqual((await readdir(join(output, 'lib'))).sort(), [
      'http.dart',
      'inputs',
      'interceptors.dart',
      'models',
      'outputs',
      'package.dart',
      'responses.dart',
    ]);
    for (const folder of ['inputs', 'models', 'outputs']) {
      assert.equal(
        await readFile(join(output, 'lib', folder, 'index.dart'), 'utf8'),
        '',
      );
    }
    assert.deepEqual(
      JSON.parse(await readFile(join(output, 'openapi.json'), 'utf8')).paths,
      {},
    );
    assert.ok(
      Array.isArray(
        JSON.parse(await readFile(join(output, 'metadata.json'), 'utf8'))
          .generatedFiles,
      ),
    );
    const pubspec = await readFile(join(output, 'pubspec.yaml'), 'utf8');
    if (directory === 'existing') {
      assert.equal(pubspec, 'name: existing_sdk\n');
      assert.equal(
        await readFile(join(output, 'readme.md'), 'utf8'),
        'My SDK documentation',
      );
    } else {
      assert.match(pubspec, /name: sdk/);
      assert.match(pubspec, /dependencies:/);
    }
  }),
);
