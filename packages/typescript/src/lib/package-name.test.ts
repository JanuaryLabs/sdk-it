import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Names', version: '1.0.0' },
  servers: [{ url: 'https://names.test' }],
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
};

for (const packageName of ['', '  ']) {
  void test(`generate refuses the package name ${JSON.stringify(packageName)}, naming packageName, and writes nothing`, async () => {
    await using output = await new TemporaryFiles().directory(
      'sdk-it-package-name-',
    );

    await assert.rejects(
      generate(spec, {
        output: output.path,
        name: 'Names',
        packageName,
        mode: 'full',
      }),
      { name: 'TypeError', message: /\bpackageName\b/ },
    );

    assert.deepEqual(await readdir(output.path), []);
  });
}
