import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import {
  type ProcessingPlugin,
  createDefaultProcessingPlugins,
  enrichExamples,
  iterateOperations,
  processSpec,
  toIR,
  walkSchemas,
} from '@sdk-it/spec';

function createSpec(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Original',
      version: '1.0.0',
    },
    paths: {},
  };
}

function createNormalizationSpec(): OpenAPIObject {
  return {
    ...createSpec(),
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            zebra: { type: 'string' },
            alpha: { type: 'string' },
          },
        },
        Account: { type: 'object' },
      },
    },
    paths: {
      '/users/:id': {
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
          },
        ],
        get: {
          operationId: 'get-user',
          parameters: [
            {
              in: 'query',
              name: 'expand',
              schema: { type: 'boolean' },
            },
          ],
          responses: {
            '404': { description: 'Not found' },
          },
        },
      },
    },
  };
}

test('processing plugins run in declared order across sync and async plugins', async () => {
  const calls: string[] = [];
  const plugins: ProcessingPlugin[] = [
    {
      name: 'first',
      process({ spec }) {
        calls.push(`first:${spec.info.title}`);
        spec.info.title = 'First';
      },
    },
    {
      name: 'second',
      async process({ spec }) {
        await Promise.resolve();
        calls.push(`second:${spec.info.title}`);
        spec.info.title = 'Second';
      },
    },
  ];

  const result = await processSpec({ spec: createSpec(), plugins });

  assert.deepStrictEqual(
    { calls, title: result.spec.info.title },
    {
      calls: ['first:Original', 'second:First'],
      title: 'Second',
    },
  );
});

test('processing stops before executing a plugin when aborted', async () => {
  const controller = new AbortController();
  let executed = false;
  controller.abort();

  await assert.rejects(
    processSpec({
      spec: createSpec(),
      signal: controller.signal,
      plugins: [
        {
          name: 'must-not-run',
          process() {
            executed = true;
          },
        },
      ],
    }),
    { name: 'AbortError' },
  );
  assert.strictEqual(executed, false);
});

test('processing rejects when the final plugin aborts while executing', async () => {
  const controller = new AbortController();

  await assert.rejects(
    processSpec({
      spec: createSpec(),
      signal: controller.signal,
      plugins: [
        {
          name: 'abort-during-processing',
          async process() {
            await Promise.resolve();
            controller.abort();
          },
        },
      ],
    }),
    { name: 'AbortError' },
  );
});

test('operation iteration exposes each operation with its path item', async () => {
  const { spec } = await processSpec({
    spec: {
      ...createSpec(),
      paths: {
        '/users/{id}': {
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' },
            },
          ],
          get: {
            operationId: 'getUser',
            responses: {},
          },
        },
      },
    },
    plugins: [],
  });

  assert.deepStrictEqual(
    [...iterateOperations(spec)].map(({ entry, operation, pathItem }) => ({
      ...entry,
      operationId: operation.operationId,
      pathParameters: pathItem.parameters?.length,
    })),
    [
      {
        method: 'get',
        path: '/users/{id}',
        tag: undefined,
        operationId: 'getUser',
        pathParameters: 1,
      },
    ],
  );
});

test('schema walking visits component schemas and their nested schemas', async () => {
  const { spec } = await processSpec({
    spec: {
      ...createSpec(),
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  displayName: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    plugins: [],
  });

  assert.deepStrictEqual(
    [...walkSchemas(spec)].map(({ pointer }) => pointer),
    [
      '#/components/schemas/User',
      '#/components/schemas/User/properties/profile',
      '#/components/schemas/User/properties/profile/properties/displayName',
    ],
  );
});

test('the default pipeline normalizes operations, responses, and schema order', async () => {
  const { spec } = await processSpec({
    spec: createNormalizationSpec(),
    plugins: createDefaultProcessingPlugins(),
  });

  const operation = spec.paths['/users/{id}'].get;
  assert.ok(operation);
  assert.deepStrictEqual(
    {
      operationId: operation.operationId,
      parameterNames: operation.parameters?.map((parameter) =>
        '$ref' in parameter ? parameter.$ref : parameter.name,
      ),
      hasSuccessResponse: '200' in (operation.responses ?? {}),
      schemas: Object.keys(spec.components.schemas),
      userProperties: Object.keys(
        'properties' in spec.components.schemas.User
          ? (spec.components.schemas.User.properties ?? {})
          : {},
      ),
    },
    {
      operationId: 'getUser',
      parameterNames: ['id', 'expand'],
      hasSuccessResponse: true,
      schemas: ['Account', 'GetUser', 'GetUserInput', 'User'],
      userProperties: ['alpha', 'zebra'],
    },
  );
});

test('operation IDs are generated, identifier-safe, and unique', async () => {
  const { spec } = await processSpec({
    spec: {
      ...createSpec(),
      paths: {
        '/users': {
          get: {
            operationId: '123 get-user',
            responses: {},
          },
        },
        '/accounts': {
          get: {
            operationId: '123 get-user',
            responses: {},
          },
        },
        '/reports': {
          post: { responses: {} },
        },
      },
    },
    plugins: createDefaultProcessingPlugins(),
  });

  const operationIds = [...iterateOperations(spec)].map(
    ({ operation }) => operation.operationId,
  );
  assert.deepStrictEqual(operationIds, [
    'operation123GetUser',
    'accountsOperation123GetUser',
    'postReports',
  ]);
  assert.ok(
    operationIds.every(
      (id) => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(id),
    ),
  );
});

test('toIR uses a caller-supplied plugin list as the complete pipeline', async () => {
  const spec = await toIR({
    spec: createSpec(),
    plugins: [
      {
        name: 'rename-api',
        process({ spec: workingSpec }) {
          workingSpec.info.title = 'Processed';
        },
      },
    ],
  });

  assert.strictEqual(spec.info.title, 'Processed');
});

test('custom plugins execute again even when processing metadata has the same name', async () => {
  let executions = 0;
  const plugins: ProcessingPlugin[] = [
    {
      name: 'count-execution',
      process() {
        executions++;
      },
    },
  ];

  const first = await processSpec({ spec: createSpec(), plugins });
  await processSpec({ spec: first.spec, plugins });

  assert.strictEqual(executions, 2);
});

test('the default pipeline is idempotent across a real second pass', async () => {
  const first = await processSpec({
    spec: createNormalizationSpec(),
    plugins: createDefaultProcessingPlugins(),
  });
  const second = await processSpec({
    spec: first.spec,
    plugins: createDefaultProcessingPlugins(),
  });

  assert.deepStrictEqual(second.spec, first.spec);
});

test('example enrichment preserves authored examples and rejects invalid generated values', async () => {
  const generatedFor: string[] = [];
  const { spec, diagnostics } = await processSpec({
    spec: {
      ...createSpec(),
      paths: {
        '/users': {
          post: {
            responses: {
              '200': {
                description: 'Authored',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    example: { id: 'authored' },
                  },
                },
              },
              '201': {
                description: 'Generated',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                      required: ['id'],
                    },
                  },
                },
              },
              '202': {
                description: 'Invalid generation',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    plugins: [
      enrichExamples({
        async generate({ statusCode }) {
          assert.ok(statusCode);
          generatedFor.push(statusCode);
          return statusCode === '201' ? { id: 'generated' } : { id: 42 };
        },
        validate({ value }) {
          return (
            typeof value === 'object' &&
            value !== null &&
            typeof (value as { id?: unknown }).id === 'string'
          );
        },
      }),
    ],
  });

  const post = spec.paths['/users'].post;
  assert.ok(post?.responses);
  const responses = post.responses;
  const example = (statusCode: string) => {
    const response = responses[statusCode];
    assert.ok(response && !('$ref' in response));
    return response.content?.['application/json'].example;
  };

  assert.deepStrictEqual(generatedFor, ['201', '202']);
  assert.deepStrictEqual(example('200'), { id: 'authored' });
  assert.deepStrictEqual(example('201'), { id: 'generated' });
  assert.strictEqual(example('202'), undefined);
  assert.ok(
    diagnostics.some(
      ({ code, severity }) =>
        code === 'generated-example-invalid' && severity === 'warning',
    ),
  );
});

test('diagnostics are attributed before plugin failures propagate', async () => {
  const observed: unknown[] = [];
  const failure = new Error('processing failed');

  await assert.rejects(
    processSpec({
      spec: createSpec(),
      onDiagnostic(diagnostic) {
        observed.push(diagnostic);
      },
      plugins: [
        {
          name: 'failing-plugin',
          process({ report }) {
            report({
              severity: 'error',
              code: 'invalid-document',
              message: 'The document cannot be processed',
            });
            throw failure;
          },
        },
      ],
    }),
    failure,
  );

  assert.deepStrictEqual(observed, [
    {
      plugin: 'failing-plugin',
      severity: 'error',
      code: 'invalid-document',
      message: 'The document cannot be processed',
    },
  ]);
});
