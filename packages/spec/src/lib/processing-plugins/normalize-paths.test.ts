import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeParameters, normalizePaths, processSpec } from '@sdk-it/spec';

test('normalized paths keep source path parameters scoped to their operations', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Paths', version: '1.0.0' },
      paths: {
        '/users/:userId': {
          parameters: [
            {
              in: 'path',
              name: 'userId',
              required: true,
              schema: { type: 'string' },
            },
          ],
          get: { operationId: 'getUser', responses: {} },
        },
        '/users/{userId}': {
          parameters: [
            {
              in: 'header',
              name: 'x-write-token',
              required: true,
              schema: { type: 'string' },
            },
          ],
          post: { operationId: 'updateUser', responses: {} },
        },
      },
    },
    plugins: [normalizePaths(), normalizeParameters()],
  });

  const pathItem = spec.paths['/users/{userId}'];
  assert.deepStrictEqual(
    pathItem.get?.parameters?.map((parameter) =>
      '$ref' in parameter ? parameter.$ref : parameter.name,
    ),
    ['userId'],
  );
  assert.deepStrictEqual(
    pathItem.post?.parameters?.map((parameter) =>
      '$ref' in parameter ? parameter.$ref : parameter.name,
    ),
    ['x-write-token'],
  );
});

test('path normalization resolves path item references and preserves metadata', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Paths', version: '1.0.0' },
      components: {
        pathItems: {
          User: {
            summary: 'Referenced summary',
            description: 'Referenced description',
            servers: [{ url: 'https://api.example.com' }],
            get: { operationId: 'getUser', responses: {} },
          },
        },
      },
      paths: {
        '/users/:userId': {
          $ref: '#/components/pathItems/User',
          summary: 'Local summary',
        },
      },
    },
    plugins: [normalizePaths()],
  });

  const pathItem = spec.paths['/users/{userId}'];
  assert.strictEqual(pathItem.summary, 'Local summary');
  assert.strictEqual(pathItem.description, 'Referenced description');
  assert.deepStrictEqual(pathItem.servers, [
    { url: 'https://api.example.com' },
  ]);
  assert.strictEqual(pathItem.get?.operationId, 'getUser');
  assert.strictEqual(pathItem.$ref, undefined);
});

test('path normalization rejects operations that collapse onto the same method', async () => {
  const diagnostics: string[] = [];

  await assert.rejects(
    processSpec({
      spec: {
        openapi: '3.1.0',
        info: { title: 'Paths', version: '1.0.0' },
        paths: {
          '/users/:userId': {
            get: { operationId: 'getExpressUser', responses: {} },
          },
          '/users/{userId}': {
            get: { operationId: 'getOpenApiUser', responses: {} },
          },
        },
      },
      plugins: [normalizePaths()],
      onDiagnostic(diagnostic) {
        diagnostics.push(`${diagnostic.severity}:${diagnostic.code}`);
      },
    }),
    /Both \/users\/:userId and \/users\/\{userId\} define GET/,
  );
  assert.deepStrictEqual(diagnostics, [
    'info:path-normalized',
    'error:path-operation-collision',
  ]);
});
