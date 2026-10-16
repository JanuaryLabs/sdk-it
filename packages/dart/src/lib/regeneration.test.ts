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
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/dart';

void test.each([undefined, true, false] as const, (cleanup) =>
  test(`regenerates an empty Dart SDK with cleanup ${cleanup ?? 'default'}`, async () => {
    await using workspace = await mkdtempDisposable(
      join(tmpdir(), 'sdk-it-dart-regenerate-'),
    );
    const output = join(workspace.path, 'client');
    const spec: OpenAPIObject = {
      openapi: '3.1.0',
      info: { title: 'Health API', version: '1.0.0' },
      components: {
        schemas: {
          HealthDetails: {
            type: 'object',
            properties: { description: { type: 'string' } },
          },
          Health: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
        },
      },
      paths: {
        '/health': {
          get: {
            operationId: 'getHealth',
            tags: ['health'],
            parameters: [
              { in: 'query', name: 'verbose', schema: { type: 'boolean' } },
            ],
            responses: {
              '200': {
                description: 'Health status',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Health' },
                  },
                },
              },
            },
          },
        },
      },
    };
    await generate(spec, { output });
    const oldApi = await readFile(join(output, 'lib/api/health.dart'), 'utf8');
    const oldModel = await readFile(
      join(output, 'lib/models/health_details.dart'),
      'utf8',
    );
    assert.match(oldApi, /getHealth/);
    assert.match(oldModel, /class HealthDetails/);

    const userFiles = {
      'pubspec.yaml': 'name: my_sdk\nversion: 2.0.0\n',
      'readme.md': 'My SDK documentation',
      'build/artifact.txt': 'Build output',
      'dist/artifact.txt': 'Distribution output',
      'lib/custom.dart': '// User code',
    };
    await mkdir(join(output, 'build'));
    await mkdir(join(output, 'dist'));
    for (const [path, content] of Object.entries(userFiles)) {
      await writeFile(join(output, path), content);
    }
    const metadataPath = join(output, 'metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    metadata.userFiles.push('/lib/custom.dart');
    await writeFile(metadataPath, JSON.stringify(metadata));

    await generate(
      { openapi: '3.1.0', info: spec.info, paths: {} },
      { output, cleanup },
    );

    if (cleanup === false) {
      assert.equal(
        await readFile(join(output, 'lib/api/health.dart'), 'utf8'),
        oldApi,
      );
      assert.equal(
        await readFile(join(output, 'lib/models/health_details.dart'), 'utf8'),
        oldModel,
      );
    } else {
      await assert.rejects(readFile(join(output, 'lib/api/health.dart')), {
        code: 'ENOENT',
      });
      for (const folder of ['inputs', 'models', 'outputs']) {
        assert.deepEqual(await readdir(join(output, 'lib', folder)), [
          'index.dart',
        ]);
        assert.equal(
          await readFile(join(output, 'lib', folder, 'index.dart'), 'utf8'),
          '',
        );
      }
    }
    for (const [path, content] of Object.entries(userFiles)) {
      assert.equal(await readFile(join(output, path), 'utf8'), content, path);
    }
    assert.deepEqual(
      JSON.parse(await readFile(metadataPath, 'utf8')).userFiles,
      metadata.userFiles,
    );
    const client = await readFile(join(output, 'lib/package.dart'), 'utf8');
    assert.match(client, /class Client/);
    assert.doesNotMatch(client, /HealthClient|api\/health\.dart/);
    assert.deepEqual(
      JSON.parse(await readFile(join(output, 'openapi.json'), 'utf8')).paths,
      {},
    );
  }),
);
