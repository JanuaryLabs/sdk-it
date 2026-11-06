import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Dispatcher, Ok, type RequestConfig, fetchType } from '@sdk-it/runtime';

/** A custom fetch that settles only when the request it received is aborted. */
function untilAborted(request: Request) {
  return new Promise<Response>((_, reject) => {
    request.signal.addEventListener(
      'abort',
      () => reject(request.signal.reason),
      { once: true },
    );
  });
}

describe('Dispatcher', () => {
  test(
    "aborting the caller's signal cancels a request sent through a custom fetch",
    { timeout: 2_000 },
    async () => {
      const controller = new AbortController();
      const dispatcher = new Dispatcher([], untilAborted);
      const config: RequestConfig = {
        url: new URL('https://example.com/users'),
        init: { method: 'GET', headers: new Headers() },
      };

      const sending = dispatcher.send(config, [Ok], controller.signal);
      controller.abort(new Error('caller cancelled'));

      await assert.rejects(sending, { message: 'caller cancelled' });
    },
  );

  test(
    'aborting a signal set on the request config cancels the request',
    { timeout: 2_000 },
    async () => {
      const controller = new AbortController();
      const dispatcher = new Dispatcher([], untilAborted);
      const config: RequestConfig = {
        url: new URL('https://example.com/users'),
        init: {
          method: 'GET',
          headers: new Headers(),
          signal: controller.signal,
        },
      };

      const sending = dispatcher.send(config, [Ok]);
      controller.abort(new Error('config cancelled'));

      await assert.rejects(sending, { message: 'config cancelled' });
    },
  );

  test('fetchType accepts a fetch called with a Request from another realm', async () => {
    const wrapped = fetchType.parse(async () => ({ ok: true, status: 200 }));
    const pseudoRequest = { url: 'https://example.com', method: 'GET' };

    assert.ok(wrapped);
    // @ts-expect-error a plain object stands in for a Request from another realm
    const result = await wrapped(pseudoRequest);

    assert.deepStrictEqual(result, { ok: true, status: 200 });
  });
});
