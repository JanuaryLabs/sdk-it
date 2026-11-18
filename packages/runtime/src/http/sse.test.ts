import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sse } from '@sdk-it/runtime';

describe('sse', () => {
  test('two iterators waiting on the same event type both settle: one takes the event, the other ends with the stream', async () => {
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    const listen = sse(new Response(readable));
    const first = listen('tick')[Symbol.asyncIterator]();
    const second = listen('tick')[Symbol.asyncIterator]();
    const waiting = [first.next(), second.next()];

    const writer = writable.getWriter();
    await writer.write(new TextEncoder().encode('event: tick\ndata: 1\n\n'));
    await writer.close();

    const results = await Promise.all(waiting);
    assert.deepEqual(
      results.map((result) => (result.done ? 'end' : result.value)).toSorted(),
      ['1', 'end'],
    );
  });

  test('aborting the request rejects every iterator that waits for an event', async () => {
    await using server = await new HttpServer().start((_, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
    });
    const controller = new AbortController();
    const response = await fetch(`${server.origin}/events`, {
      signal: controller.signal,
    });
    const listen = sse(response);
    const first = listen('tick')[Symbol.asyncIterator]();
    const second = listen('tick')[Symbol.asyncIterator]();
    const waiting = [first.next(), second.next()];

    controller.abort(new Error('caller cancelled'));

    const results = await Promise.allSettled(waiting);
    assert.deepEqual(
      results.map((result) => result.status),
      ['rejected', 'rejected'],
    );
  });
});
