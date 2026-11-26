import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const meta = { const: { x: 1, tags: ['a'] } };

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Labels', version: '1.0.0' },
  servers: [{ url: 'https://api.test' }],
  paths: {
    '/labels': {
      post: {
        operationId: 'label',
        tags: ['labels'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { meta },
                required: ['meta'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Labelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { meta },
                  required: ['meta'],
                },
              },
            },
          },
        },
      },
    },
  },
};

async function generated(prefix: string) {
  const workspace = await workspaceDirectory(prefix);
  await generate(spec, {
    output: workspace.path,
    name: 'Labels',
    packageName: '@acme/labels',
    readme: false,
    mode: 'full',
  });
  return workspace;
}

void test('an object const accepts exactly its JSON value and refuses any other', async () => {
  // Arrange
  await using workspace = await generated('const-object-');
  const { createLabels } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createLabels({
    baseUrl: 'https://api.test',
    fetch: async () => Response.json({ meta: { x: 1, tags: ['a'] } }),
  });

  // Act and assert
  await assert.doesNotReject(
    client.request('POST /labels', { meta: { x: 1, tags: ['a'] } }),
  );
  for (const wrong of [
    { x: 2, tags: ['a'] },
    { x: 1, tags: ['a'], y: 0 },
    { x: 1, tags: ['b'] },
  ]) {
    await assert.rejects(
      client.request('POST /labels', { meta: wrong }),
      parseErrorFor('meta'),
    );
  }
});

void test('an object const is typed as its JSON value in the input and the response', async () => {
  // Arrange
  await using workspace = await generated('const-object-type-');
  await writeFile(
    join(workspace.path, 'src', 'consumer.ts'),
    [
      "import { labels, type LabelsEndpoints } from './index.ts';",
      "type Input = LabelsEndpoints['POST /labels']['input'];",
      "const ok: Input['meta'] = { x: 1, tags: ['a'] };",
      '// @ts-expect-error x is 1',
      "const wrong: Input['meta'] = { x: 2, tags: ['a'] };",
      "const result = await labels.request('POST /labels', { meta: ok });",
      "const read: { x: 1; tags: ['a'] } = result.meta;",
      '// @ts-expect-error tags is ["a"]',
      "const misread: { x: 1; tags: ['b'] } = result.meta;",
      'export { ok, wrong, read, misread };',
      '',
    ].join('\n'),
  );

  // Act
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));

  // Assert
  assert.deepEqual(diagnostics, []);
});
