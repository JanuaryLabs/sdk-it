import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import {
  createDefaultDocumentPlugins,
  finalizeOperations,
  forEachOperation,
  processDocument,
} from '@sdk-it/spec';

function createSpec(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    components: {
      requestBodies: {
        NewPet: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    paths: {
      '/pets': {
        get: {
          tags: ['Pets'],
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': { schema: { type: 'array' } },
              },
            },
          },
        },
        post: {
          tags: ['Pets'],
          operationId: 'createPet',
          requestBody: { $ref: '#/components/requestBodies/NewPet' },
          responses: { '201': { description: 'Created' } },
        },
      },
    },
  };
}

test('a fully processed document finalizes into an IR whose operations iterate with their entries', async () => {
  const { spec: document } = await processDocument({
    spec: createSpec(),
    plugins: createDefaultDocumentPlugins(),
  });

  const ir = finalizeOperations(document);

  assert.deepStrictEqual(
    forEachOperation(ir, (entry, operation) => ({
      ...entry,
      operationId: operation.operationId,
      group: operation['x-fn-group'],
      bodies: Object.values(operation.responses).map(
        (response) => response['x-body'],
      ),
      requestSchema:
        operation.requestBody.content['application/json']?.schema.$ref,
    })),
    [
      {
        method: 'get',
        path: '/pets',
        tag: 'pets',
        operationId: 'listPets',
        group: 'Pets',
        bodies: ['json'],
        requestSchema: undefined,
      },
      {
        method: 'post',
        path: '/pets',
        tag: 'pets',
        operationId: 'createPet',
        group: 'Pets',
        bodies: ['empty'],
        requestSchema: '#/components/schemas/CreatePet',
      },
    ],
  );
});

test('an operation the document plugins did not process is refused with its name and field', async () => {
  const { spec: document } = await processDocument({
    spec: createSpec(),
    plugins: [],
  });

  assert.throws(() => finalizeOperations(document), {
    name: 'Error',
    message:
      'Spec processing left GET /pets with an untuned x-fn-name: it is not a string',
  });
});

test('a request body left as a $ref is refused with its operation and field', async () => {
  const spec = createSpec();
  const post = spec.paths?.['/pets']?.post;
  assert.ok(post);
  const { spec: document } = await processDocument({
    spec: { ...spec, paths: { '/pets': { post } } },
    plugins: createDefaultDocumentPlugins().filter(
      (plugin) => plugin.name !== 'normalize-request-bodies',
    ),
  });

  assert.throws(() => finalizeOperations(document), {
    name: 'Error',
    message:
      'Spec processing left POST /pets with an untuned requestBody: it is a $ref',
  });
});
