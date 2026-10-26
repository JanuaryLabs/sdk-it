import { HttpServer } from '@zukhruf/testing/http';
import { test } from '@zukhruf/testing/node';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { toIR } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

const items = ['a', 'b', 'c', 'd', 'e'];

void test.each(
  [
    {
      type: 'offset',
      parameters: { limit: 'integer', offset: 'integer' },
      input: { limit: 2, offset: 0 },
      window: (query: URLSearchParams) => {
        const start = Number(query.get('offset'));
        return { start, end: start + Number(query.get('limit')) };
      },
    },
    {
      type: 'page',
      parameters: { page: 'integer', pageSize: 'integer' },
      input: { page: 1, pageSize: 2 },
      window: (query: URLSearchParams) => {
        const size = Number(query.get('pageSize'));
        const start = (Number(query.get('page')) - 1) * size;
        return { start, end: start + size };
      },
    },
    {
      type: 'cursor',
      parameters: { cursor: 'string', limit: 'integer' },
      input: { limit: 2 },
      window: (query: URLSearchParams) => {
        const start = Number(query.get('cursor') ?? 0);
        return { start, end: start + Number(query.get('limit')) };
      },
    },
  ] as const,
  ({ type, parameters, input, window }) =>
    test(`for await over a ${type}-paginated response yields every page, starting with the first`, async () => {
      await using workspace = await mkdtempDisposable(
        join(
          fileURLToPath(new URL('../../../../', import.meta.url)),
          '.pagination-iteration-',
        ),
      );
      const spec: OpenAPIObject = {
        openapi: '3.1.0',
        info: { title: 'Paged', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              parameters: Object.entries(parameters).map(([name, kind]) => ({
                in: 'query',
                name,
                schema: { type: kind },
              })),
              responses: {
                '200': {
                  description: 'Page',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['data', 'hasMore'],
                        properties: {
                          data: { type: 'array', items: { type: 'string' } },
                          hasMore: { type: 'boolean' },
                          ...(type === 'cursor'
                            ? { nextCursor: { type: 'string' } }
                            : {}),
                        },
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
      assert.equal(ir.paths['/items'].get?.['x-pagination']?.type, type);
      await generate(spec, {
        output: workspace.path,
        name: 'Paged',
        mode: 'minimal',
        readme: false,
      });
      await writeFile(
        join(workspace.path, 'consumer.ts'),
        `
import { Paged } from './index.ts';

export async function exercise(baseUrl: string) {
  const pages = await new Paged({ baseUrl }).request('GET /items', ${JSON.stringify(input)});
  const received: string[][] = [];
  for await (const page of pages) received.push(page.data);
  return received;
}
`,
      );
      const bundle = join(workspace.path, 'consumer.mjs');
      await build({
        entryPoints: [join(workspace.path, 'consumer.ts')],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        logLevel: 'silent',
      });
      const requests: string[] = [];
      await using server = await new HttpServer().start((request, response) => {
        const query = new URL(request.url ?? '/', 'http://localhost')
          .searchParams;
        requests.push(query.toString());
        const { start, end } = window(query);
        const hasMore = end < items.length;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            data: items.slice(start, end),
            hasMore,
            ...(type === 'cursor' && hasMore
              ? { nextCursor: String(end) }
              : {}),
          }),
        );
      });

      const received = await (
        await import(pathToFileURL(bundle).href)
      ).exercise(server.origin);

      assert.deepEqual(received, [['a', 'b'], ['c', 'd'], ['e']]);
      assert.equal(requests.length, 3);
    }),
);
