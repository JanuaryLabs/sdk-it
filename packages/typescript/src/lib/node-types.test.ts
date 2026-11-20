import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// A Node app has no DOM lib: its fetch, Response and Blob come from
// @types/node, whose Blob takes only ArrayBuffer-backed views.
const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Files', version: '1.0.0' },
  servers: [{ url: 'https://files.test' }],
  paths: {
    '/report': {
      get: {
        operationId: 'downloadReport',
        tags: ['files'],
        responses: {
          '200': {
            description: 'The report',
            content: { 'application/octet-stream': {} },
          },
        },
      },
    },
  },
};

void test.each(['full', 'minimal'] as const, (mode) =>
  test(`a generated ${mode} SDK type-checks with only Node's types`, async () => {
    await using workspace = await workspaceDirectory('node-types-');
    await generate(spec, {
      output: workspace.path,
      name: 'Files',
      packageName: '@acme/files',
      mode,
      readme: false,
    });
    const source =
      mode === 'full' ? join(workspace.path, 'src') : workspace.path;

    const { files, diagnostics } = typecheck({
      tsconfig: {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['esnext'],
          types: ['node'],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ['**/*.ts'],
      },
      directory: source,
    });

    assert.ok(files.some((file) => file.endsWith('/http/parse-response.ts')));
    assert.deepEqual(diagnostics, []);
  }),
);
