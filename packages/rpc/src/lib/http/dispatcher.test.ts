import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { RequestConfig } from '../http/request.ts';
import { Dispatcher, fetchType } from './dispatcher.ts';
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

  test('fetchType accepts fetch funcs called with cross-realm Request/Response', async () => {
    const wrapped = fetchType.parse(async () => {
      return { ok: true, status: 200 } as unknown as Response;
    });

    assert.ok(wrapped, 'fetchType.parse should return the wrapped fetch');
    const pseudoRequest = { url: 'https://example.com', method: 'GET' };
    const result = await wrapped(pseudoRequest as unknown as Request);
    assert.deepStrictEqual(result, { ok: true, status: 200 });
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
