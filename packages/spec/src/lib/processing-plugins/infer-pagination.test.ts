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
    irPlugins: [inferPagination()],
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

test("a paging parameter's spec default becomes the pagination start", async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Datacenters', version: '1.0.0' },
      paths: {
        '/datacenters': {
          get: {
            operationId: 'listDatacenters',
            parameters: [
              {
                in: 'query',
                name: 'page',
                schema: { type: 'integer', default: 1 },
              },
              {
                in: 'query',
                name: 'per_page',
                schema: { type: 'integer', default: 25 },
              },
            ],
            responses: {
              '200': {
                description: 'Datacenters',
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
    irPlugins: [inferPagination()],
  });

  assert.equal(spec.paths['/datacenters'].get?.['x-pagination']?.type, 'page');
  assert.equal(
    spec.paths['/datacenters'].get?.['x-pagination'] &&
      'start' in spec.paths['/datacenters'].get['x-pagination']
      ? spec.paths['/datacenters'].get['x-pagination'].start
      : undefined,
    1,
  );
});

test("a JSON body offset's spec default becomes the pagination start", async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Files', version: '1.0.0' },
      paths: {
        '/listFiles': {
          post: {
            operationId: 'listFiles',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      limit: { type: 'number', default: 500 },
                      offset: { type: 'number', default: 0 },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Files',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        files: { type: 'array', items: { type: 'string' } },
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
    irPlugins: [inferPagination()],
  });

  const pagination = spec.paths['/listFiles'].post?.['x-pagination'];
  assert.equal(pagination?.type, 'offset');
  assert.equal(
    pagination && 'start' in pagination ? pagination.start : undefined,
    0,
  );
});
