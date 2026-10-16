import { HttpServer } from '@zukhruf/testing/http';
import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';
import ts from 'typescript';

import { toIR } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

void test.each(['anyOf', 'oneOf'] as const, (composition) =>
  test(`cursor inference rejects a path missing from a ${composition} response variant`, async () => {
    const ir = await toIR({
      spec: {
        openapi: '3.1.0',
        info: { title: 'Cursor variants', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              parameters: [
                { in: 'query', name: 'cursor', schema: { type: 'string' } },
                { in: 'query', name: 'limit', schema: { type: 'integer' } },
              ],
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
                          pagination: {
                            [composition]: [
                              {
                                type: 'object',
                                properties: { nextCursor: { type: 'string' } },
                              },
                              {
                                type: 'object',
                                properties: { reason: { type: 'string' } },
                              },
                            ],
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
      },
    });
    const pagination = ir.paths['/items'].get?.['x-pagination'];
    assert.ok(pagination?.type === 'cursor');
    assert.equal(pagination.nextCursor, undefined);
  }),
);

void test.each(['full', 'minimal'] as const, (mode) =>
  test.each(['query', 'body'] as const, (transport) =>
    test.each(
      [
        {
          name: 'standard',
          input: 'cursor',
          field: 'nextCursor',
          parent: '',
          explicit: false,
        },
        {
          name: 'required standard',
          input: 'cursor',
          field: 'nextCursor',
          parent: '',
          explicit: false,
          required: true,
        },
        {
          name: 'renamed',
          input: 'after',
          field: 'next_cursor',
          parent: '',
          explicit: false,
        },
        {
          name: 'required renamed',
          input: 'after',
          field: 'next_cursor',
          parent: '',
          explicit: false,
          required: true,
        },
        {
          name: 'nested',
          input: 'pageToken',
          field: 'next_page_token',
          parent: 'pagination',
          explicit: false,
        },
        {
          name: 'nullable envelope',
          input: 'cursor',
          field: 'nextCursor',
          parent: 'pagination',
          explicit: false,
        },
        {
          name: 'mixed token',
          input: 'cursor',
          field: 'nextCursor',
          parent: '',
          explicit: false,
        },
        {
          name: 'explicit',
          input: 'resume',
          field: 'resume-token',
          parent: 'links',
          explicit: true,
        },
        {
          name: 'configured',
          input: 'after',
          field: 'continuationToken',
          parent: '',
          explicit: true,
        },
        {
          name: 'referenced',
          input: 'cursor',
          field: 'end_cursor',
          parent: 'pageInfo',
          explicit: false,
        },
      ],
      ({ name, input, field, parent, explicit, required = false }) =>
        test(`generated ${mode} SDK advances ${name} cursors in ${transport} requests`, async () => {
          await using workspace = await mkdtempDisposable(
            join(
              fileURLToPath(new URL('../../../../', import.meta.url)),
              '.cursor-continuation-',
            ),
          );
          try {
            const cursorPath = parent ? `${parent}.${field}` : field;
            const cursorSchema: SchemaObject =
              name === 'referenced'
                ? { anyOf: [{ type: 'string' }, { type: 'null' }] }
                : {
                    type:
                      name === 'mixed token'
                        ? ['string', 'number', 'null']
                        : ['string', 'null'],
                  };
            let envelopeSchema: SchemaObject = {
              type: 'object',
              properties: { [field]: cursorSchema },
            };
            if (name === 'nullable envelope') {
              envelopeSchema = {
                [transport === 'query' ? 'anyOf' : 'oneOf']: [
                  envelopeSchema,
                  { type: 'null' },
                ],
              };
              if (mode === 'minimal')
                envelopeSchema = { allOf: [envelopeSchema] };
            }
            const properties: Record<string, SchemaObject> = {
              [input]: { type: 'string' },
              limit: { type: 'integer' },
              filter: { type: 'string' },
              scenario: { type: 'string' },
            };
            const method = transport === 'query' ? 'GET' : 'POST';
            const spec: OpenAPIObject = {
              openapi: '3.1.0',
              info: { title: 'Cursor', version: '1.0.0' },
              ...(name === 'referenced'
                ? {
                    components: {
                      schemas: {
                        PageInfo: {
                          type: 'object',
                          properties: {
                            [field]: { $ref: '#/components/schemas/Token' },
                          },
                        },
                        Token: cursorSchema,
                      },
                    },
                  }
                : {}),
              paths: {
                '/items': {
                  [method.toLowerCase()]: {
                    operationId: 'listItems',
                    ...(explicit
                      ? {
                          'x-pagination': {
                            type: 'cursor',
                            cursorParamName: input,
                            limitParamName: 'limit',
                            items: 'items',
                            hasMore: 'hasMore',
                            ...(name === 'explicit'
                              ? { nextCursor: cursorPath }
                              : {}),
                            statusCode: 200,
                          },
                        }
                      : {}),
                    ...(transport === 'query'
                      ? {
                          parameters: Object.entries(properties).map(
                            ([name, schema]) => ({
                              in: 'query',
                              name,
                              schema,
                              required: required && name === input,
                            }),
                          ),
                        }
                      : {
                          requestBody: {
                            required: true,
                            content: {
                              'application/json': {
                                schema: {
                                  type: 'object',
                                  properties,
                                  ...(required ? { required: [input] } : {}),
                                },
                              },
                            },
                          },
                        }),
                    responses: {
                      '200': {
                        description: 'Page',
                        content: {
                          'application/json': {
                            schema: {
                              type: 'object',
                              properties: {
                                items: {
                                  type: 'array',
                                  items: { type: 'string' },
                                },
                                hasMore: { type: 'boolean' },
                                ...(parent
                                  ? {
                                      [parent]:
                                        name === 'referenced'
                                          ? {
                                              $ref: '#/components/schemas/PageInfo',
                                            }
                                          : envelopeSchema,
                                    }
                                  : { [field]: cursorSchema }),
                                ...(name === 'explicit'
                                  ? { nextCursor: { type: 'string' } }
                                  : {}),
                              },
                              required: ['items', 'hasMore'],
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            };
            const ir = await toIR({ spec });
            const pagination =
              ir.paths['/items'][transport === 'query' ? 'get' : 'post']?.[
                'x-pagination'
              ];
            assert.ok(pagination?.type === 'cursor');
            assert.equal(pagination.nextCursor, cursorPath);
            await generate(spec, {
              output: workspace.path,
              name: 'Cursor',
              mode,
              readme: false,
            });
            const source =
              mode === 'full' ? join(workspace.path, 'src') : workspace.path;
            await writeFile(
              join(source, 'consumer.ts'),
              `
import assert from 'node:assert/strict';
import { Cursor } from './index.ts';

export async function exercise(baseUrl: string) {
  const client = new Cursor({ baseUrl });
  const input = { ${input}: 'start/? &+#', limit: 2, filter: 'preserved', scenario: 'complete' };
  const pages = await client.request('${method} /items', input);
  const received = [pages.getCurrentPage().data];
  assert.equal(pages.metadata.nextCursor, 'next/? &+#');
  await pages.getNextPage();
  received.push(pages.getCurrentPage().data);
  assert.equal(pages.metadata.nextCursor, '');
  for await (const page of pages) received.push(page.data);
  assert.deepEqual(received, [['first'], ['second'], ['third']]);
  assert.equal(pages.hasMore, false);
  assert.equal(pages.metadata.nextCursor, undefined);
  for await (const page of pages) assert.fail('Pagination must stop after its final page');
  assert.deepEqual(input, { ${input}: 'start/? &+#', limit: 2, filter: 'preserved', scenario: 'complete' });

  for (const scenario of ${JSON.stringify(name === 'mixed token' ? ['missing', 'null', 'number'] : ['missing', 'null'])}) {
    const broken = await client.request('${method} /items', { ...input, scenario });
    assert.deepEqual(broken.getCurrentPage().data, ['first']);
    await assert.rejects(broken.getNextPage(), /next cursor/i);
  }
}
`,
            );
            const config = ts.parseJsonConfigFileContent(
              {
                compilerOptions: {
                  target: 'ESNext',
                  module: 'ESNext',
                  moduleResolution: 'bundler',
                  types: ['node'],
                  strict: true,
                  exactOptionalPropertyTypes: true,
                  skipLibCheck: true,
                  noEmit: true,
                  allowImportingTsExtensions: true,
                },
                include: ['**/*.ts'],
              },
              ts.sys,
              source,
            );
            assert.deepEqual(config.errors, []);
            const diagnostics = ts.getPreEmitDiagnostics(
              ts.createProgram(config.fileNames, config.options),
            );
            assert.equal(
              diagnostics.length,
              0,
              ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                getCanonicalFileName: (file) => file,
                getCurrentDirectory: () => source,
                getNewLine: () => '\n',
              }),
            );
            const bundle = join(workspace.path, 'consumer.mjs');
            await build({
              entryPoints: [join(source, 'consumer.ts')],
              outfile: bundle,
              bundle: true,
              platform: 'node',
              format: 'esm',
              target: 'node24',
              logLevel: 'silent',
            });
            const requests: Record<string, unknown>[] = [];
            await using server = await new HttpServer().start(
              async (request, response) => {
                let values: Record<string, unknown>;
                if (request.method === 'GET') {
                  values = Object.fromEntries(
                    new URL(request.url ?? '/', 'http://localhost')
                      .searchParams,
                  );
                  values.limit = Number(values.limit);
                } else {
                  const chunks: Buffer[] = [];
                  for await (const chunk of request)
                    chunks.push(Buffer.from(chunk));
                  values = JSON.parse(Buffer.concat(chunks).toString());
                }
                requests.push(values);
                if (requests.length > (name === 'mixed token' ? 6 : 5)) {
                  response.writeHead(500).end('Pagination repeated a request');
                  return;
                }
                const index = ['start/? &+#', 'next/? &+#', ''].indexOf(
                  String(values[input]),
                );
                const result: Record<string, unknown> = {
                  items: [
                    index === 0 ? 'first' : index === 1 ? 'second' : 'third',
                  ],
                  hasMore: index !== 2,
                  ...(name === 'explicit'
                    ? { nextCursor: 'wrong-cursor' }
                    : {}),
                };
                if (values.scenario !== 'missing') {
                  const cursor =
                    values.scenario === 'number'
                      ? 42
                      : values.scenario === 'null' || index === 2
                        ? null
                        : index === 0
                          ? 'next/? &+#'
                          : '';
                  if (parent)
                    result[parent] =
                      name === 'nullable envelope' && values.scenario === 'null'
                        ? null
                        : { [field]: cursor };
                  else result[field] = cursor;
                }
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify(result));
              },
            );
            await (
              await import(pathToFileURL(bundle).href)
            ).exercise(server.origin);
            assert.deepEqual(requests, [
              {
                [input]: 'start/? &+#',
                limit: 2,
                filter: 'preserved',
                scenario: 'complete',
              },
              {
                [input]: 'next/? &+#',
                limit: 2,
                filter: 'preserved',
                scenario: 'complete',
              },
              {
                [input]: '',
                limit: 2,
                filter: 'preserved',
                scenario: 'complete',
              },
              {
                [input]: 'start/? &+#',
                limit: 2,
                filter: 'preserved',
                scenario: 'missing',
              },
              {
                [input]: 'start/? &+#',
                limit: 2,
                filter: 'preserved',
                scenario: 'null',
              },
              ...(name === 'mixed token'
                ? [
                    {
                      [input]: 'start/? &+#',
                      limit: 2,
                      filter: 'preserved',
                      scenario: 'number',
                    },
                  ]
                : []),
            ]);
          } finally {
            stop();
          }
        }),
    ),
  ),
);
