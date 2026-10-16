import { HttpServer } from '@zukhruf/testing/http';
import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';
import ts from 'typescript';

import { generate } from '@sdk-it/typescript';

void test.each(['full', 'minimal'] as const, (mode) =>
  test.each(['query', 'body'] as const, (transport) =>
    test.each([false, true], (renamed) =>
      test(`generated ${mode} SDK supports nullable ${transport} pagination with ${renamed ? 'renamed' : 'standard'} fields`, async () => {
        await using workspace = await mkdtempDisposable(
          join(
            fileURLToPath(new URL('../../../../', import.meta.url)),
            '.nullable-pagination-',
          ),
        );
        try {
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
import { Pages } from './index.ts';

function received(value: unknown) {
  assert.ok(typeof value === 'string');
  return JSON.parse(value);
}

export async function exercise(baseUrl: string) {
  const client = new Pages({ baseUrl });
  for (const [initial, expectedOffset, nextOffset, expectedPage, nextPage] of [
    [null, 0, 0, null, 1],
    [undefined, 0, 0, undefined, 1],
    [0, 0, 0, 0, 1],
    [3, 3, 6, 3, 4],
  ] as const) {
    const offsets = await client.request('${method} /offset', { tag: 'preserved', ${offset}: initial, ${limit}: initial });
    assert.deepEqual(received(offsets.getCurrentPage().data[0]!), { tag: 'preserved', ${offset}: expectedOffset, ${limit}: expectedOffset });
    await offsets.getNextPage();
    assert.deepEqual(received(offsets.getCurrentPage().data[0]!), { tag: 'preserved', ${offset}: nextOffset, ${limit}: expectedOffset });

    const pages = await client.request('${method} /page', { tag: 'preserved', ${page}: initial, ${pageSize}: initial });
    assert.deepEqual(received(pages.getCurrentPage().data[0]!), expectedPage === undefined ? { tag: 'preserved' } : { tag: 'preserved', ${page}: expectedPage, ${pageSize}: expectedPage });
    await pages.getNextPage();
    assert.deepEqual(received(pages.getCurrentPage().data[0]!), expectedPage === undefined ? { tag: 'preserved', ${page}: nextPage } : { tag: 'preserved', ${page}: nextPage, ${pageSize}: expectedPage });
  }
  const omitted = await client.request('${method} /offset', { tag: 'preserved' });
  assert.deepEqual(received(omitted.getCurrentPage().data[0]!), { tag: 'preserved', ${offset}: 0, ${limit}: 0 });
  const omittedPage = await client.request('${method} /page', { tag: 'preserved' });
  assert.deepEqual(received(omittedPage.getCurrentPage().data[0]!), { tag: 'preserved' });
  const mixedOffsets = await client.request('${method} /offset', { tag: 'preserved', ${offset}: null, ${limit}: 2 });
  assert.deepEqual(received(mixedOffsets.getCurrentPage().data[0]!), { tag: 'preserved', ${offset}: 0, ${limit}: 2 });
  await mixedOffsets.getNextPage();
  assert.deepEqual(received(mixedOffsets.getCurrentPage().data[0]!), { tag: 'preserved', ${offset}: 2, ${limit}: 2 });
  const mixedPages = await client.request('${method} /page', { tag: 'preserved', ${page}: null, ${pageSize}: 2 });
  assert.deepEqual(received(mixedPages.getCurrentPage().data[0]!), { tag: 'preserved', ${page}: null, ${pageSize}: 2 });
  await mixedPages.getNextPage();
  assert.deepEqual(received(mixedPages.getCurrentPage().data[0]!), { tag: 'preserved', ${page}: 1, ${pageSize}: 2 });
  // @ts-expect-error Null remains invalid when the schema is not nullable.
  await assert.rejects(client.request('${method} /strict-offset', { tag: 'preserved', ${offset}: null }));
  // @ts-expect-error Null remains invalid for non-nullable page fields.
  await assert.rejects(client.request('${method} /strict-page', { tag: 'preserved', ${page}: null }));
}

function invalid(client: Pages) {
  // @ts-expect-error Unrelated required fields remain required.
  void client.request('${method} /offset', { ${offset}: null });
  // @ts-expect-error Pagination values must still be numeric or null.
  void client.request('${method} /page', { tag: 'preserved', ${page}: 'invalid' });
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
                const chunks: Buffer[] = [];
                for await (const chunk of request)
                  chunks.push(Buffer.from(chunk));
                input = JSON.parse(Buffer.concat(chunks).toString());
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
            await import(pathToFileURL(bundle).href)
          ).exercise(server.origin);
        } finally {
          stop();
        }
      }),
    ),
  ),
);
