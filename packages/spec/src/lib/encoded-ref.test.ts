import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toIR } from '@sdk-it/spec';

void test('toIR follows a path item reference that encodes / as ~1', async () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/a': { $ref: '#/paths/~1b' },
      '/b': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  };

  const ir = await toIR({ spec });

  assert.deepEqual(Object.keys(ir.paths['/a']), ['get']);
});
