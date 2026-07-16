import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inferPagination, processSpec } from '@sdk-it/spec';

test('pagination inference uses the actual successful response status', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Pagination', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'getUsers',
            parameters: [
              { in: 'query', name: 'offset', schema: { type: 'integer' } },
              { in: 'query', name: 'limit', schema: { type: 'integer' } },
            ],
            responses: {
              '206': {
                description: 'Partial content',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        items: { type: 'array', items: { type: 'string' } },
                        hasMore: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    plugins: [inferPagination()],
  });

  assert.deepStrictEqual(spec.paths['/users'].get?.['x-pagination'], {
    type: 'offset',
    offsetParamName: 'offset',
    offsetKeyword: 'offset',
    limitParamName: 'limit',
    limitKeyword: 'limit',
    items: 'items',
    hasMore: 'hasMore',
    statusCode: 206,
  });
});
