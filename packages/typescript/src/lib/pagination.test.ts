import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const templatesDir = join(
  dirname(new URL(import.meta.url).pathname),
  'paginations',
);
const sourceDir = dirname(new URL(import.meta.url).pathname);

async function loadPaginationModule(templateName: string) {
  const source = await readFile(join(templatesDir, templateName), 'utf-8');
  const tempDir = await mkdtemp(join(tmpdir(), 'sdk-it-pagination-'));
  const modulePath = join(tempDir, templateName.replace('.txt', '.ts'));

  await writeFile(modulePath, source);

  const module = await import(pathToFileURL(modulePath).href);
  return {
    module,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

describe('pagination templates', () => {
  test('offset pagination lets callers override the signal for a page fetch', async () => {
    const { module, cleanup } = await loadPaginationModule(
      'offset-pagination.txt',
    );

    try {
      const { OffsetPagination } = module as {
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
      };

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
    } finally {
      await cleanup();
    }
  });

  test('cursor pagination lets callers override the signal for a page fetch', async () => {
    const { module, cleanup } = await loadPaginationModule(
      'cursor-pagination.txt',
    );

    try {
      const { CursorPagination } = module as {
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
      };

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
    } finally {
      await cleanup();
    }
  });

  test('page pagination lets callers override the signal for a page fetch', async () => {
    const { module, cleanup } = await loadPaginationModule(
      'page-pagination.txt',
    );

    try {
      const { Pagination } = module as {
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
      };

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
    } finally {
      await cleanup();
    }
  });

  test('page pagination advances the page number across fetches', async () => {
    const { module, cleanup } = await loadPaginationModule(
      'page-pagination.txt',
    );

    try {
      const { Pagination } = module as {
        Pagination: new (
          initialParams: { page?: number; pageSize?: number },
          fetchFn: (input: {
            page?: number;
            pageSize?: number;
          }) => Promise<{ data: unknown[]; meta: { hasMore?: boolean } }>,
        ) => {
          getNextPage: () => Promise<unknown>;
        };
      };

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
    } finally {
      await cleanup();
    }
  });

  test('sdk pagination generation forwards default and per-page signals', async () => {
    const source = await readFile(join(sourceDir, 'sdk.ts'), 'utf-8');

    assert.match(
      source,
      /new OffsetPagination\([^\n]+, async \(nextPageParams, requestOptions\) => \{[\s\S]*requestOptions\?\.signal \?\? options\.signal,[\s\S]*\}, \{ signal: options\.signal \}\);/,
    );
    assert.match(
      source,
      /new CursorPagination\([^\n]+, async \(nextPageParams, requestOptions\) => \{[\s\S]*requestOptions\?\.signal \?\? options\.signal,[\s\S]*\}, \{ signal: options\.signal \}\);/,
    );
    assert.match(
      source,
      /new Pagination\([^\n]+, async \(nextPageParams, requestOptions\) => \{[\s\S]*requestOptions\?\.signal \?\? options\.signal,[\s\S]*\}, \{ signal: options\.signal \}\);/,
    );
    assert.match(
      source,
      /if \(pagination\.type === 'page'\) \{[\s\S]*new Pagination\([^\n]+, async \(nextPageParams, requestOptions\) => \{[\s\S]*\}, \{ signal: options\.signal \}\);[\s\S]*await pagination\.getNextPage\(\);[\s\S]*return \$\{returnValue\}/,
    );
  });
});
