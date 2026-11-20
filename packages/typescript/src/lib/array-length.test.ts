import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { parseErrorFor, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Posts', version: '1.0.0' },
  paths: {
    '/posts': {
      post: {
        operationId: 'createPost',
        tags: ['posts'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tags: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                  },
                  labels: {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: 2,
                  },
                  extras: { type: 'array', maxItems: 1 },
                },
                required: ['tags', 'labels'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tags: { type: 'integer' },
                    labels: { type: 'integer' },
                  },
                  required: ['tags', 'labels'],
                },
              },
            },
          },
        },
      },
    },
  },
};

void test('an array input outside minItems..maxItems is refused before the request is sent', async () => {
  // Arrange
  await using workspace = await workspaceDirectory('array-length-');
  await generate(spec, {
    output: workspace.path,
    name: 'Posts',
    packageName: '@acme/posts',
    readme: false,
    mode: 'full',
  });
  const { createPosts } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createPosts({
    baseUrl: 'https://api.test',
    fetch: async (request: Request) => {
      const { tags, labels } = await request.json();
      return Response.json({ tags: tags.length, labels: labels.length });
    },
  });

  // Act and assert
  await assert.rejects(
    client.request('POST /posts', { tags: [], labels: [] }),
    parseErrorFor('tags'),
  );
  await assert.rejects(
    client.request('POST /posts', { tags: ['a'], labels: ['a', 'b', 'c'] }),
    parseErrorFor('labels'),
  );
  await assert.rejects(
    client.request('POST /posts', { tags: ['a'], labels: [], extras: [1, 2] }),
    parseErrorFor('extras'),
  );
  assert.deepEqual(
    await client.request('POST /posts', { tags: ['a'], labels: [] }),
    { tags: 1, labels: 0 },
  );
  assert.deepEqual(
    await client.request('POST /posts', {
      tags: ['a', 'b', 'c'],
      labels: ['a', 'b'],
    }),
    { tags: 3, labels: 2 },
  );
});
