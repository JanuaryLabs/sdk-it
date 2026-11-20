import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const shape = { enum: [{ kind: 'circle' }, [1, 2], 'plain'] };

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Shapes', version: '1.0.0' },
  servers: [{ url: 'https://api.test' }],
  paths: {
    '/shapes': {
      post: {
        operationId: 'draw',
        tags: ['shapes'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { shape },
                required: ['shape'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Drawn',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { shape },
                  required: ['shape'],
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
    name: 'Shapes',
    packageName: '@acme/shapes',
    readme: false,
    mode: 'full',
  });
  return workspace;
}

void test('an enum with object and array members accepts each member and refuses any other value', async () => {
  // Arrange
  await using workspace = await generated('enum-json-values-');
  const { createShapes } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createShapes({
    baseUrl: 'https://api.test',
    fetch: async () => Response.json({ shape: 'plain' }),
  });

  // Act and assert
  for (const member of [{ kind: 'circle' }, [1, 2], 'plain']) {
    await assert.doesNotReject(
      client.request('POST /shapes', { shape: member }),
    );
  }
  for (const wrong of [{ kind: 'square' }, [1], { kind: 'circle', extra: 1 }]) {
    await assert.rejects(
      client.request('POST /shapes', { shape: wrong }),
      parseErrorFor('shape'),
    );
  }
});

void test('an enum with object and array members is typed as the union of its JSON values', async () => {
  // Arrange
  await using workspace = await generated('enum-json-values-type-');
  await writeFile(
    join(workspace.path, 'src', 'consumer.ts'),
    [
      "import { shapes, type ShapesEndpoints } from './index.ts';",
      "type Input = ShapesEndpoints['POST /shapes']['input'];",
      "const circle: Input['shape'] = { kind: 'circle' };",
      "const pair: Input['shape'] = [1, 2];",
      "const plain: Input['shape'] = 'plain';",
      '// @ts-expect-error kind is circle',
      "const square: Input['shape'] = { kind: 'square' };",
      "const result = await shapes.request('POST /shapes', { shape: pair });",
      "const read: { kind: 'circle' } | [1, 2] | 'plain' = result.shape;",
      '// @ts-expect-error shape is never a string other than plain',
      "const misread: { kind: 'circle' } | [1, 2] | 'other' = result.shape;",
      'export { circle, pair, plain, square, read, misread };',
      '',
    ].join('\n'),
  );

  // Act
  const { diagnostics } = typecheck(join(workspace.path, 'tsconfig.json'));

  // Assert
  assert.deepEqual(diagnostics, []);
});
