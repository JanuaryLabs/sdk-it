import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/dart';

const localDart = spawnSync('dart', ['--version']).status === 0;
const docker = spawnSync('docker', ['info']).status === 0;

/** Runs `script` with the Dart SDK in `directory`: the local SDK, or the dart:stable image. */
function dart(directory: string, script: string) {
  return localDart
    ? spawnSync('sh', ['-c', script], { cwd: directory, encoding: 'utf8' })
    : spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${directory}:/app`,
          '-w',
          '/app',
          'dart:stable',
          'sh',
          '-c',
          script,
        ],
        { encoding: 'utf8' },
      );
}

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Releases', version: '1.0.0' },
  components: {
    schemas: {
      Channel: {
        oneOf: [
          { type: 'string', const: 'dev' },
          { type: 'string', const: 'preview' },
          { type: 'string', format: 'uri' },
          { type: 'number' },
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
    },
  },
  paths: {
    '/channel': {
      get: {
        operationId: 'getChannel',
        tags: ['releases'],
        responses: {
          '200': {
            description: 'The channel',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Channel' },
              },
            },
          },
          '412': { description: 'Precondition failed' },
        },
      },
    },
  },
};

void test(
  'a generated Dart SDK analyzes without errors and decodes every variant of a oneOf: string literals, a uri, a number, plain text and a list',
  {
    skip:
      !localDart && !docker
        ? 'needs a local Dart SDK or a running Docker daemon (dart:stable)'
        : false,
  },
  async () => {
    await using workspace = await new TemporaryFiles().directory(
      'sdk-it-dart-one-of-',
    );
    await generate(spec, { output: workspace.path, mode: 'full' });
    await writeFile(
      join(workspace.path, 'main.dart'),
      `import 'dart:convert';

import './lib/package.dart';

void main() {
  // Decoded the way a response body is, so a list is a List<dynamic>.
  final values = jsonDecode('["dev", "preview", "https://example.com/feed", "nightly", 3.5, ["a", "b"]]') as List;
  for (final value in values) {
    print('decoded \${Channel.fromJson(value).toJson()}');
  }
}
`,
    );

    const run = dart(
      workspace.path,
      'dart pub get >/dev/null && dart analyze --no-fatal-warnings lib && dart run main.dart',
    );

    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.doesNotMatch(run.stdout, /error -|unreachable_switch_case/);
    assert.deepEqual(
      run.stdout.split('\n').filter((line) => line.startsWith('decoded ')),
      [
        'decoded dev',
        'decoded preview',
        'decoded https://example.com/feed',
        'decoded nightly',
        'decoded 3.5',
        'decoded [a, b]',
      ],
    );
  },
);
