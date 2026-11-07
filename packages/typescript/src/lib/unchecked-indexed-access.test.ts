import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Indexed', version: '1.0.0' },
  servers: [{ url: 'https://indexed.test' }],
  security: [{ key: [] }],
  components: {
    securitySchemes: {
      key: { type: 'apiKey', in: 'header', name: 'x-key' },
    },
  },
  paths: {
    '/notes': {
      get: {
        operationId: 'listNotes',
        tags: ['notes'],
        parameters: [
          { in: 'query', name: 'offset', schema: { type: 'integer' } },
          { in: 'query', name: 'limit', schema: { type: 'integer' } },
        ],
        'x-pagination': {
          type: 'offset',
          offsetParamName: 'offset',
          limitParamName: 'limit',
          items: 'items',
          hasMore: 'hasMore',
          statusCode: 200,
        },
        responses: {
          '200': {
            description: 'Page',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { type: 'string' } },
                    hasMore: { type: 'boolean' },
                  },
                  required: ['items', 'hasMore'],
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createNote',
        tags: ['notes'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { '204': { description: 'No Content' } },
      },
    },
    '/notes/{noteId}': {
      get: {
        operationId: 'getNote',
        tags: ['notes'],
        parameters: [
          {
            in: 'path',
            name: 'noteId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Note',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
          '404': { description: 'Not Found' },
        },
      },
    },
  },
};

void test.each(['full', 'minimal'] as const, (mode) =>
  test(`a generated ${mode} SDK type-checks under noUncheckedIndexedAccess`, async () => {
    await using workspace = await workspaceDirectory('unchecked-indexed-');
    await generate(spec, {
      output: workspace.path,
      name: 'Indexed',
      packageName: '@acme/indexed',
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
          strict: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ['**/*.ts'],
      },
      directory: source,
    });

    assert.ok(files.some((file) => file.endsWith('/http/dispatcher.ts')));
    assert.deepEqual(diagnostics, []);
  }),
);
