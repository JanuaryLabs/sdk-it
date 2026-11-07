import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

void test("an endpoint's result is what request() resolves to: the Page for a paginated endpoint, the body otherwise", async () => {
  await using workspace = await workspaceDirectory('endpoint-result-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Paged', version: '1.0.0' },
      servers: [{ url: 'https://paged.test' }],
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            parameters: [
              { in: 'query', name: 'limit', schema: { type: 'integer' } },
              { in: 'query', name: 'offset', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'A page of items',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        data: { type: 'array', items: { type: 'string' } },
                        hasMore: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/ping': {
          get: {
            operationId: 'ping',
            responses: {
              '200': {
                description: 'Pong',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { ok: { type: 'boolean' } },
                      required: ['ok'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    { output: workspace.path, name: 'Paged', readme: false, mode: 'full' },
  );
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `import { createPaged, type PagedEndpoints } from './index.ts';
const client = createPaged({ baseUrl: 'https://paged.test' });
type Items = PagedEndpoints['GET /items']['result'];
type Ping = PagedEndpoints['GET /ping']['result'];
export async function first(): Promise<Items> {
  return client.request('GET /items', {});
}
export async function next(page: Items): Promise<Items | undefined> {
  return page.hasNextPage() ? page.getNextPage() : undefined;
}
export async function items(page: Items): Promise<string[]> {
  return Array.fromAsync(page);
}
export async function ping(): Promise<Ping> {
  return client.request('GET /ping', {});
}
export const ok = (pong: Ping): boolean => pong.ok;
// @ts-expect-error a body that does not page has no paging methods
export const pages = (pong: Ping) => pong.getNextPage();
`,
  );

  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});
