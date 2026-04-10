import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { RequestConfig } from '../http/request.ts';
import { Dispatcher } from './dispatcher.ts';
import { Ok } from './response.ts';

describe('Dispatcher', () => {
  test('passes AbortSignal to a custom fetch via the Request object', async () => {
    let receivedRequest: Request | undefined;

    const dispatcher = new Dispatcher([], async (request: Request) => {
      receivedRequest = request;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    const config: RequestConfig = {
      url: new URL('https://example.com/users'),
      init: {
        method: 'GET',
        headers: new Headers(),
      },
    };

    const response = await dispatcher.send(config, [Ok], controller.signal);

    assert.ok(receivedRequest);
    assert.equal(receivedRequest.signal.aborted, false);
    controller.abort();
    assert.equal(receivedRequest.signal.aborted, true);
    assert.deepStrictEqual(response.data, { ok: true });
  });

  test('preserves an AbortSignal already present on the request config', async () => {
    let receivedRequest: Request | undefined;

    const dispatcher = new Dispatcher([], async (request: Request) => {
      receivedRequest = request;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    const config: RequestConfig = {
      url: new URL('https://example.com/users'),
      init: {
        method: 'GET',
        headers: new Headers(),
        signal: controller.signal,
      },
    };

    const response = await dispatcher.send(config, [Ok]);

    assert.ok(receivedRequest);
    assert.equal(receivedRequest.signal.aborted, false);
    controller.abort();
    assert.equal(receivedRequest.signal.aborted, true);
    assert.deepStrictEqual(response.data, { ok: true });
  });
});
