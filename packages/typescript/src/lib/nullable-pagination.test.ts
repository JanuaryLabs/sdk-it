import { HttpServer } from '@zukhruf/testing/http';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

void test.each(['full', 'minimal'] as const, (mode) =>
  test.each(['query', 'body'] as const, (transport) =>
    test.each([false, true], (renamed) =>
      test(`generated ${mode} SDK supports nullable ${transport} pagination with ${renamed ? 'renamed' : 'standard'} fields`, async () => {
        await using workspace = await workspaceDirectory(
          'nullable-pagination-',
        );
        const offset = renamed ? 'start_index' : 'offset';
        const limit = renamed ? 'count' : 'limit';
        const page = renamed ? 'page_number' : 'page';
        const pageSize = renamed ? 'per_page' : 'pageSize';
        const spec: OpenAPIObject = {
          openapi: '3.1.0',
          info: { title: 'Pages', version: '1.0.0' },
          paths: {},
        };
        assert.ok(spec.paths);
        for (const [path, names, nullable] of [
          ['/offset', [offset, limit], true],
          ['/page', [page, pageSize], true],
          ['/strict-offset', [offset, limit], false],
          ['/strict-page', [page, pageSize], false],
        ] as const) {
          const properties: Record<string, SchemaObject> = {
            tag: { type: 'string' },
            ...Object.fromEntries(
              names.map((name) => [
                name,
                { type: nullable ? ['integer', 'null'] : 'integer' },
              ]),
            ),
          };
          spec.paths[path] = {
            [transport === 'query' ? 'get' : 'post']: {
              operationId: `list${path.slice(1).replaceAll('-', '')}`,
              ...(transport === 'query'
                ? {
                    parameters: Object.entries(properties).map(
                      ([name, schema]) => ({
                        in: 'query',
                        name,
                        required: name === 'tag',
                        schema,
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
                            required: ['tag'],
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
          name: 'Pages',
          mode,
          readme: false,
        });
        const source =
          mode === 'full' ? join(workspace.path, 'src') : workspace.path;
        const method = transport === 'query' ? 'GET' : 'POST';
        await writeFile(
          join(source, 'consumer.ts'),
          `
import assert from 'node:assert/strict';
import { createPages, type PagesClient } from './index.ts';

function received(value: unknown) {
  assert.ok(typeof value === 'string');
  return JSON.parse(value);
}

export async function exercise(baseUrl: string) {
  const client = createPages({ baseUrl });
  for (const [initial, firstOffsets, nextOffsets, firstPages, nextPages] of [
    [null, { ${offset}: null, ${limit}: null }, { ${offset}: 1, ${limit}: null }, { ${page}: null, ${pageSize}: null }, { ${page}: 2, ${pageSize}: null }],
    [undefined, {}, { ${offset}: 1 }, {}, { ${page}: 2 }],
    [0, { ${offset}: 0, ${limit}: 0 }, { ${offset}: 1, ${limit}: 0 }, { ${page}: 0, ${pageSize}: 0 }, { ${page}: 1, ${pageSize}: 0 }],
    [3, { ${offset}: 3, ${limit}: 3 }, { ${offset}: 4, ${limit}: 3 }, { ${page}: 3, ${pageSize}: 3 }, { ${page}: 4, ${pageSize}: 3 }],
  ] as const) {
    const offsets = await client.request('${method} /offset', { tag: 'preserved', ${offset}: initial, ${limit}: initial });
    assert.deepEqual(received(offsets.items[0]!), { tag: 'preserved', ...firstOffsets });
    const nextOffsetPage = await offsets.getNextPage();
    assert.deepEqual(received(nextOffsetPage.items[0]!), { tag: 'preserved', ...nextOffsets });

    const pages = await client.request('${method} /page', { tag: 'preserved', ${page}: initial, ${pageSize}: initial });
    assert.deepEqual(received(pages.items[0]!), { tag: 'preserved', ...firstPages });
    const nextPage = await pages.getNextPage();
    assert.deepEqual(received(nextPage.items[0]!), { tag: 'preserved', ...nextPages });
  }
  const omitted = await client.request('${method} /offset', { tag: 'preserved' });
  assert.deepEqual(received(omitted.items[0]!), { tag: 'preserved' });
  const omittedPage = await client.request('${method} /page', { tag: 'preserved' });
  assert.deepEqual(received(omittedPage.items[0]!), { tag: 'preserved' });
  const mixedOffsets = await client.request('${method} /offset', { tag: 'preserved', ${offset}: null, ${limit}: 2 });
  assert.deepEqual(received(mixedOffsets.items[0]!), { tag: 'preserved', ${offset}: null, ${limit}: 2 });
  const nextMixedOffsets = await mixedOffsets.getNextPage();
  assert.deepEqual(received(nextMixedOffsets.items[0]!), { tag: 'preserved', ${offset}: 1, ${limit}: 2 });
  const mixedPages = await client.request('${method} /page', { tag: 'preserved', ${page}: null, ${pageSize}: 2 });
  assert.deepEqual(received(mixedPages.items[0]!), { tag: 'preserved', ${page}: null, ${pageSize}: 2 });
  const nextMixedPages = await mixedPages.getNextPage();
  assert.deepEqual(received(nextMixedPages.items[0]!), { tag: 'preserved', ${page}: 2, ${pageSize}: 2 });
  // @ts-expect-error Null remains invalid when the schema is not nullable.
  await assert.rejects(client.request('${method} /strict-offset', { tag: 'preserved', ${offset}: null }));
  // @ts-expect-error Null remains invalid for non-nullable page fields.
  await assert.rejects(client.request('${method} /strict-page', { tag: 'preserved', ${page}: null }));
}

function invalid(client: PagesClient) {
  // @ts-expect-error Unrelated required fields remain required.
  void client.request('${method} /offset', { ${offset}: null });
  // @ts-expect-error Pagination values must still be numeric or null.
  void client.request('${method} /page', { tag: 'preserved', ${page}: 'invalid' });
}
void invalid;
`,
        );
        const { diagnostics } = typecheck({
          tsconfig: {
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
          directory: source,
        });
        assert.deepEqual(diagnostics, []);
        await using server = await new HttpServer().start(
          async (request, response) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            let input: unknown;
            if (request.method === 'GET') {
              input = Object.fromEntries(
                [...url.searchParams].map(([name, value]) => [
                  name,
                  value === 'null'
                    ? null
                    : /^\d+$/.test(value)
                      ? Number(value)
                      : value,
                ]),
              );
            } else {
              input = await json(request);
            }
            response.setHeader('Content-Type', 'application/json');
            response.end(
              JSON.stringify({
                items: [JSON.stringify(input)],
                hasMore: false,
              }),
            );
          },
        );
        await (
          await import(pathToFileURL(join(source, 'consumer.ts')).href)
        ).exercise(server.origin);
      }),
    ),
  ),
);
