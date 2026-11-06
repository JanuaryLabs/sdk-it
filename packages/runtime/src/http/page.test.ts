import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { z } from 'zod';

import {
  type DispatchOptions,
  Dispatcher,
  Ok,
  type Pagination,
  type Route,
  createClient,
  empty,
  toRequest,
} from '@sdk-it/runtime';

/** `GET /items`, shaped the way a generated SDK's endpoint table is, paging as `pagination` says. */
function itemsRoute<Body, const P extends Pagination>(
  pagination: P,
  query: string[],
) {
  return {
    schema: z.object(
      Object.fromEntries(
        query.map((name) => [
          name,
          z.union([z.number(), z.string()]).optional(),
        ]),
      ),
    ),
    output: [Ok<Body>],
    security: [],
    pagination,
    toRequest(input: Record<string, unknown>, baseUrl: string) {
      return toRequest(
        'GET',
        '/items',
        empty(input, {
          contentType: 'application/json',
          inputHeaders: [],
          inputQuery: query,
          inputBody: [],
          inputParams: [],
        }),
        baseUrl,
      );
    },
    dispatch(
      input: Record<string, unknown>,
      options: DispatchOptions,
    ): Promise<Ok<Body>> {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(
        this.toRequest(input, options.baseUrl),
        this.output,
        options.signal,
      );
    },
  } satisfies Route;
}

function itemsClient<Body extends object, const P extends Pagination>(
  pagination: P,
  query: string[],
  answer: (url: URL) => Body,
) {
  return createClient(
    {
      routes: { 'GET /items': itemsRoute<Body, P>(pagination, query) },
      servers: ['https://api.test'],
      securitySchemes: {},
      credentials: z.object({}),
    },
    {
      fetch: async (request) => Response.json(answer(new URL(request.url))),
    },
  );
}

const offsetPaging = {
  type: 'offset',
  offsetParamName: 'offset',
  limitParamName: 'limit',
  items: 'data.items',
  hasMore: 'data.more',
  statusCode: 200,
} as const;

/** Two items per page, stamped with the offset the server received, three pages in all. */
function offsetAnswer(url: URL) {
  const sent = url.searchParams.get('offset');
  const offset = Number(sent ?? 0);
  return {
    sent,
    data: {
      items: [`item ${offset}`, `item ${offset + 1}`],
      more: offset < 4,
    },
  };
}

describe('Page', () => {
  test('an offset page asks for the next page at the offset sent plus the items received', async () => {
    const client = itemsClient(offsetPaging, ['offset', 'limit'], offsetAnswer);

    const first = await client.request('GET /items', { offset: 2, limit: 2 });
    const next = await first.getNextPage();

    assert.equal(next.sent, '4');
  });

  test('an offset the spec gives no start for is left out first, then counted from zero', async () => {
    const client = itemsClient(offsetPaging, ['offset', 'limit'], offsetAnswer);

    const first = await client.request('GET /items', { limit: 2 });
    const next = await first.getNextPage();

    assert.equal(first.sent, null);
    assert.equal(next.sent, '2');
  });

  test('an offset left out starts from the spec default', async () => {
    const client = itemsClient(
      { ...offsetPaging, start: 10 },
      ['offset', 'limit'],
      offsetAnswer,
    );

    const first = await client.request('GET /items', { limit: 2 });
    const next = await first.getNextPage();

    assert.equal(next.sent, '12');
  });

  test('a numbered page asks for the page after the one sent, or after the spec default', async () => {
    const paging = {
      type: 'page',
      pageNumberParamName: 'page',
      pageSizeParamName: 'per_page',
      items: 'items',
      hasMore: 'more',
      statusCode: 200,
    } as const;
    const answer = (url: URL) => ({
      page: url.searchParams.get('page'),
      items: [],
      more: true,
    });
    const client = itemsClient(paging, ['page', 'per_page'], answer);
    const startsAtZero = itemsClient(
      { ...paging, start: 0 },
      ['page', 'per_page'],
      answer,
    );

    const afterThird = await (
      await client.request('GET /items', { page: 3 })
    ).getNextPage();
    const afterOmitted = await (
      await client.request('GET /items', {})
    ).getNextPage();
    const afterDefault = await (
      await startsAtZero.request('GET /items', {})
    ).getNextPage();

    assert.deepEqual(
      [afterThird.page, afterOmitted.page, afterDefault.page],
      ['4', '2', '1'],
    );
  });

  test('a cursor page sends the cursor the response names, and refuses to guess one it does not', async () => {
    const paging = {
      type: 'cursor',
      cursorParamName: 'after',
      items: 'items',
      hasMore: 'more',
      statusCode: 200,
      nextCursor: 'next',
    } as const;
    const client = itemsClient(paging, ['after'], (url) => ({
      after: url.searchParams.get('after'),
      items: [],
      more: true,
      next: url.searchParams.has('after') ? undefined : 'c2',
    }));

    const first = await client.request('GET /items', {});
    const second = await first.getNextPage();

    assert.equal(second.after, 'c2');
    await assert.rejects(second.getNextPage(), {
      message: 'The response says more pages exist but names no next cursor',
    });
  });

  test('iterating pages starts with the current page and stops when the response says no more', async () => {
    const client = itemsClient(offsetPaging, ['offset', 'limit'], offsetAnswer);

    const first = await client.request('GET /items', { limit: 2 });
    const pages = await Array.fromAsync(first.iterPages(), (page) => page.sent);

    assert.deepEqual(pages, [null, '2', '4']);
  });

  test('a request that is not awaited iterates every item across pages', async () => {
    const client = itemsClient(offsetPaging, ['offset', 'limit'], offsetAnswer);

    const items = await Array.fromAsync(
      client.request('GET /items', { limit: 2 }),
    );

    assert.deepEqual(items, [
      'item 0',
      'item 1',
      'item 2',
      'item 3',
      'item 4',
      'item 5',
    ]);
  });

  test('a page serializes to the response body', async () => {
    const client = itemsClient(offsetPaging, ['offset', 'limit'], offsetAnswer);

    const page = await client.request('GET /items', { offset: 4, limit: 2 });

    assert.deepEqual(
      JSON.parse(JSON.stringify(page)),
      offsetAnswer(new URL('https://api.test/items?offset=4&limit=2')),
    );
  });

  test('a response with a status other than the paging one rejects', async () => {
    const client = createClient(
      {
        routes: {
          'GET /items': itemsRoute<object, Pagination>(
            { ...offsetPaging, statusCode: 206 },
            ['offset', 'limit'],
          ),
        },
        servers: ['https://api.test'],
        securitySchemes: {},
        credentials: z.object({}),
      },
      {
        fetch: async () => Response.json({ data: { items: [], more: false } }),
      },
    );

    await assert.rejects(client.request('GET /items', {}), { status: 200 });
  });
});
