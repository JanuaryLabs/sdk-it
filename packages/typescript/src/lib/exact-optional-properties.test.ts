import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import ts from 'typescript';

import { generate } from '@sdk-it/typescript';

void test.each(['full', 'minimal'] as const, (mode) =>
  test.each(['omitted', 'undefined', 'provided'] as const, (parameters) =>
    test(`generated ${mode} SDK supports exact optional properties with parameters ${parameters}`, async () => {
      const provided = parameters === 'provided';
      await using workspace = await mkdtempDisposable(
        join(
          fileURLToPath(new URL('../../../../', import.meta.url)),
          '.exact-optional-',
        ),
      );
      try {
        const spec: OpenAPIObject = {
          openapi: '3.1.0',
          info: { title: 'Exact', version: '1.0.0' },
          paths: {
            '/echo': {
              get: {
                operationId: 'readEcho',
                responses: {
                  '200': {
                    description: 'Echo',
                    content: {
                      'application/json': { schema: { type: 'string' } },
                    },
                  },
                },
              },
              post: {
                operationId: 'writeEcho',
                requestBody: {
                  required: true,
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { message: { type: 'string' } },
                        required: ['message'],
                      },
                    },
                  },
                },
                responses: {
                  '200': {
                    description: 'Echo',
                    content: {
                      'application/json': { schema: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        };
        assert.ok(spec.paths);
        for (const [kind, params, pagination] of [
          ['cursor', ['cursor'], { cursorParamName: 'cursor' }],
          [
            'page',
            ['page', 'pageSize'],
            { pageNumberParamName: 'page', pageSizeParamName: 'pageSize' },
          ],
          [
            'offset',
            ['offset', 'limit'],
            { offsetParamName: 'offset', limitParamName: 'limit' },
          ],
        ] as const) {
          spec.paths[`/${kind}`] = {
            get: {
              operationId: `list${kind}`,
              parameters: params.map((name) => ({
                in: 'query',
                name,
                schema: { type: kind === 'cursor' ? 'string' : 'integer' },
              })),
              'x-pagination': {
                type: kind,
                ...pagination,
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
          };
        }
        await generate(spec, {
          output: workspace.path,
          name: 'Exact',
          mode,
          readme: false,
        });
        const source =
          mode === 'full' ? join(workspace.path, 'src') : workspace.path;
        await writeFile(
          join(source, 'consumer.ts'),
          `
import assert from 'node:assert/strict';
import { Exact } from './index.ts';
import { CursorPagination } from './pagination/cursor-pagination.ts';
import { Pagination } from './pagination/page-pagination.ts';

export async function exercise() {
  const controller = new AbortController();
  const options = ${provided ? '{ signal: controller.signal }' : '{}'};
  const requests: Request[] = [];
  const client = new Exact({ baseUrl: 'https://example.test', fetch: async (request: Request) => {
    requests.push(request);
    return new URL(request.url).pathname === '/echo' ? Response.json('ok') : Response.json({ items: ['item'], hasMore: false });
  } });
  const get = await client.prepare('GET /echo', {}, options);
  assert.equal(Object.hasOwn(get.init, 'body'), false);
  assert.equal(Object.hasOwn(get.init, 'signal'), ${provided});
  const post = await client.prepare('POST /echo', { message: 'hello' }, options);
  assert.equal(post.init.body, JSON.stringify({ message: 'hello' }));
  assert.equal(await client.request('GET /echo', {}, options), 'ok');
  assert.equal(await client.request('POST /echo', { message: 'hello' }, options), 'ok');
  const cursorPage = await client.request('GET /cursor', ${provided ? "{ cursor: 'start' }" : parameters === 'undefined' ? '{ cursor: undefined }' : '{}'}, options);
  const page = await client.request('GET /page', ${provided ? '{ page: 2, pageSize: 3 }' : parameters === 'undefined' ? '{ page: undefined, pageSize: undefined }' : '{}'}, options);
  const offsetPage = await client.request('GET /offset', ${provided ? '{ offset: 2, limit: 3 }' : parameters === 'undefined' ? '{ offset: undefined, limit: undefined }' : '{}'}, options);
  assert.deepEqual([cursorPage.getCurrentPage().data, page.getCurrentPage().data, offsetPage.getCurrentPage().data], [['item'], ['item'], ['item']]);
  assert.deepEqual(requests.map((request) => new URL(request.url).search), ${provided ? JSON.stringify(['', '', '?cursor=start', '?page=2&pageSize=3', '?limit=3&offset=2']) : JSON.stringify(['', '', '', '', '?limit=0&offset=0'])});
  assert.equal(await requests[0]!.text(), '');
  assert.equal(await requests[1]!.text(), JSON.stringify({ message: 'hello' }));
  controller.abort();
  assert.ok(requests.every((request) => request.signal.aborted === ${provided}));

  const cursorInputs: unknown[] = [];
  const cursor = new CursorPagination(${provided ? "{ cursor: 'start' }" : parameters === 'undefined' ? '{ cursor: undefined }' : '{ cursor: null }'}, async (input) => {
    cursorInputs.push({ ...input });
    return { data: [], meta: cursorInputs.length === 1 ? { nextCursor: 'next' } : {} };
  });
  await cursor.getNextPage();
  await cursor.getNextPage();
  await cursor.getNextPage();
  assert.deepEqual(cursorInputs, [${provided ? "{ cursor: 'start' }" : '{}'}, { cursor: 'next' }, {}]);
  const pageInputs: unknown[] = [];
  const pages = new Pagination(${provided ? '{ page: 2, pageSize: 3 }' : parameters === 'undefined' ? '{ page: undefined, pageSize: undefined }' : '{}'}, async (input) => {
    pageInputs.push({ ...input });
    return { data: [], meta: {} };
  });
  await pages.getNextPage();
  await pages.getNextPage();
  assert.deepEqual(pageInputs, ${provided ? '[{ page: 2, pageSize: 3 }, { page: 3, pageSize: 3 }]' : '[{}, { page: 1 }]'});
}

function invalid(client: Exact) {
  // @ts-expect-error Required request values cannot be omitted.
  void client.request('POST /echo', {});
  // @ts-expect-error Required request values cannot be undefined.
  void client.request('POST /echo', { message: undefined });
  // @ts-expect-error Signals must remain AbortSignal values.
  void client.request('GET /echo', {}, { signal: 'invalid' });
}
void invalid;
`,
        );
        const config = ts.parseJsonConfigFileContent(
          {
            compilerOptions: {
              target: 'ESNext',
              module: 'ESNext',
              moduleResolution: 'bundler',
              strict: true,
              types: ['node'],
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
        await (await import(pathToFileURL(bundle).href)).exercise();
      } finally {
        stop();
      }
    }),
  ),
);
