import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toIR } from '@sdk-it/spec';

void test('toIR rejects responses whose references form a cycle, naming the cycle', async () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Loop', version: '1.0.0' },
    components: {
      responses: {
        A: { $ref: '#/components/responses/B' },
        B: { $ref: '#/components/responses/A' },
      },
    },
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          responses: {
            '200': { description: 'OK' },
            '404': { $ref: '#/components/responses/A' },
          },
        },
      },
    },
  };

  await assert.rejects(toIR({ spec }), {
    name: 'Error',
    message:
      /^Circular \$ref #\/components\/responses\/A -> #\/components\/responses\/B -> #\/components\/responses\/A:/,
  });
});

void test('toIR rejects path items whose references form a cycle, naming the cycle', async () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Loop', version: '1.0.0' },
    components: {
      pathItems: {
        A: { $ref: '#/components/pathItems/B' },
        B: { $ref: '#/components/pathItems/A' },
      },
    },
    paths: { '/a': { $ref: '#/components/pathItems/A' } },
  };

  await assert.rejects(toIR({ spec }), {
    name: 'Error',
    message:
      /^Circular \$ref #\/components\/pathItems\/A -> #\/components\/pathItems\/B -> #\/components\/pathItems\/A:/,
  });
});
