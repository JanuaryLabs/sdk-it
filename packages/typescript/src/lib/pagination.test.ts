import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { OperationPagination } from '@sdk-it/spec';

const templatesDir = join(
  dirname(new URL(import.meta.url).pathname),
  'paginations',
);
async function loadPaginationModule(directory: string, templateName: string) {
  const source = await readFile(join(templatesDir, templateName), 'utf-8');
  const modulePath = join(directory, templateName.replace('.txt', '.ts'));

  await writeFile(modulePath, source);

  return import(pathToFileURL(modulePath).href);
}

describe('pagination templates', () => {
  test('offset pagination lets callers override the signal for a page fetch', async () => {
    await using directory = await new TemporaryFiles().directory('pagination-');
    const module = await loadPaginationModule(
      directory.path,
      'offset-pagination.txt',
    );

    const {
      OffsetPagination,
    }: {
      OffsetPagination: new (
        initialParams: { offset?: number; limit?: number },
        fetchFn: (
          input: { offset: number; limit: number },
          requestOptions?: { signal?: AbortSignal },
        ) => Promise<{ data: unknown[]; meta: { hasMore?: boolean } }>,
        requestOptions?: { signal?: AbortSignal },
      ) => {
        getNextPage: (requestOptions?: {
          signal?: AbortSignal;
        }) => Promise<unknown>;
      };
    } = module;

    const defaultController = new AbortController();
    const overrideController = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const pagination = new OffsetPagination(
      { offset: 0, limit: 20 },
      async (_input, requestOptions) => {
        receivedSignal = requestOptions?.signal;
        return { data: [], meta: { hasMore: false } };
      },
      { signal: defaultController.signal },
    );

    await pagination.getNextPage({ signal: overrideController.signal });

    assert.strictEqual(receivedSignal, overrideController.signal);
  });

  test('cursor pagination lets callers override the signal for a page fetch', async () => {
    await using directory = await new TemporaryFiles().directory('pagination-');
    const module = await loadPaginationModule(
      directory.path,
      'cursor-pagination.txt',
    );

    const {
      CursorPagination,
    }: {
      CursorPagination: new (
        initialParams: { cursor?: string | null },
        fetchFn: (
          input: { cursor?: string },
          requestOptions?: { signal?: AbortSignal },
        ) => Promise<{
          data: unknown[];
          meta: { hasMore?: boolean; nextCursor?: string };
        }>,
        requestOptions?: { signal?: AbortSignal },
      ) => {
        getNextPage: (requestOptions?: {
          signal?: AbortSignal;
        }) => Promise<unknown>;
      };
    } = module;

    const defaultController = new AbortController();
    const overrideController = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const pagination = new CursorPagination(
      { cursor: null },
      async (_input, requestOptions) => {
        receivedSignal = requestOptions?.signal;
        return {
          data: [],
          meta: { hasMore: false, nextCursor: undefined },
        };
      },
      { signal: defaultController.signal },
    );

    await pagination.getNextPage({ signal: overrideController.signal });

    assert.strictEqual(receivedSignal, overrideController.signal);
  });

  test('page pagination lets callers override the signal for a page fetch', async () => {
    await using directory = await new TemporaryFiles().directory('pagination-');
    const module = await loadPaginationModule(
      directory.path,
      'page-pagination.txt',
    );

    const {
      Pagination,
    }: {
      Pagination: new (
        initialParams: { page?: number; pageSize?: number },
        fetchFn: (
          input: { page?: number; pageSize?: number },
          requestOptions?: { signal?: AbortSignal },
        ) => Promise<{ data: unknown[]; meta: { hasMore?: boolean } }>,
        requestOptions?: { signal?: AbortSignal },
      ) => {
        getNextPage: (requestOptions?: {
          signal?: AbortSignal;
        }) => Promise<unknown>;
      };
    } = module;

    const defaultController = new AbortController();
    const overrideController = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const pagination = new Pagination(
      { page: 1, pageSize: 20 },
      async (_input, requestOptions) => {
        receivedSignal = requestOptions?.signal;
        return { data: [], meta: { hasMore: false } };
      },
      { signal: defaultController.signal },
    );

    await pagination.getNextPage({ signal: overrideController.signal });

    assert.strictEqual(receivedSignal, overrideController.signal);
  });

  test('page pagination advances the page number across fetches', async () => {
    await using directory = await new TemporaryFiles().directory('pagination-');
    const module = await loadPaginationModule(
      directory.path,
      'page-pagination.txt',
    );

    const {
      Pagination,
    }: {
      Pagination: new (
        initialParams: { page?: number; pageSize?: number },
        fetchFn: (input: {
          page?: number;
          pageSize?: number;
        }) => Promise<{ data: unknown[]; meta: { hasMore?: boolean } }>,
      ) => {
        getNextPage: () => Promise<unknown>;
      };
    } = module;

    const seenPages: Array<number | undefined> = [];
    const pagination = new Pagination(
      { page: 1, pageSize: 20 },
      async (input) => {
        seenPages.push(input.page);
        return { data: [], meta: { hasMore: seenPages.length < 2 } };
      },
    );

    await pagination.getNextPage();
    await pagination.getNextPage();

    assert.deepStrictEqual(seenPages, [1, 2]);
  });

  test('sdk pagination generation forwards default and per-page signals', async () => {
    const { paginationOperation } = await import('./pagination-emit.ts');

    const cases: { className: string; pagination: OperationPagination }[] = [
      {
        className: 'OffsetPagination',
        pagination: {
          type: 'offset',
          items: 'items',
          hasMore: 'hasMore',
          statusCode: 200,
          limitParamName: 'limit',
          limitKeyword: 'limit',
          offsetParamName: 'offset',
          offsetKeyword: 'offset',
        },
      },
      {
        className: 'CursorPagination',
        pagination: {
          type: 'cursor',
          items: 'items',
          hasMore: 'hasMore',
          statusCode: 200,
          cursorParamName: 'cursor',
          cursorKeyword: 'cursor',
          limitParamName: 'limit',
          limitKeyword: 'limit',
        },
      },
      {
        className: 'Pagination',
        pagination: {
          type: 'page',
          items: 'items',
          hasMore: 'hasMore',
          statusCode: 200,
          pageNumberParamName: 'page',
          pageNumberKeyword: 'page',
          pageSizeParamName: 'pageSize',
          pageSizeKeyword: 'pageSize',
        },
      },
    ];

    for (const { className, pagination } of cases) {
      const source = paginationOperation(pagination);
      assert.match(
        source,
        new RegExp(
          `new ${className}\\([^\\n]+, async \\(nextPageParams, requestOptions\\) => \\{[\\s\\S]*requestOptions\\?\\.signal \\?\\? options\\.signal,[\\s\\S]*\\}, options\\.signal \\? \\{ signal: options\\.signal \\} : \\{\\}\\);`,
        ),
      );
      assert.match(source, /await pagination\.getNextPage\(\);/);
    }
  });
});
