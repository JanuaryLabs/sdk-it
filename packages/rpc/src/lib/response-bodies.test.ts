import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Created, Ok, rpc } from '@sdk-it/rpc';

test('RPC client resolves a response that declares no content with null data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-rpc-bodies-'));
  try {
    const specPath = join(dir, 'openapi.json');
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Things', version: '1.0.0' },
        paths: {
          '/things': {
            post: {
              operationId: 'createThing',
              tags: ['things'],
              responses: { '201': { description: 'Created' } },
            },
          },
        },
      }),
    );
    const client = await rpc(specPath, {
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response(null, {
          status: 201,
          headers: { 'Content-Length': '0' },
        }),
    });

    const response = await client.request('POST /things', {});

    assert.ok(response instanceof Created);
    assert.equal(response.data, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('RPC client hands an octet-stream response over as a stream', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-rpc-bodies-'));
  try {
    const specPath = join(dir, 'openapi.json');
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Files', version: '1.0.0' },
        paths: {
          '/export': {
            get: {
              operationId: 'exportData',
              tags: ['files'],
              responses: {
                '200': {
                  description: 'Export',
                  content: { 'application/octet-stream': {} },
                },
              },
            },
          },
        },
      }),
    );
    const client = await rpc(specPath, {
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    });

    const response = await client.request('GET /export', {});

    assert.ok(response instanceof Ok);
    assert.ok(response.data instanceof ReadableStream);
    assert.deepStrictEqual(
      new Uint8Array(await new Response(response.data).arrayBuffer()),
      new Uint8Array([1, 2, 3]),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('RPC client hands server-sent events over as a listener', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-rpc-bodies-'));
  try {
    const specPath = join(dir, 'openapi.json');
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Events', version: '1.0.0' },
        paths: {
          '/events': {
            get: {
              operationId: 'streamEvents',
              tags: ['events'],
              responses: {
                '200': {
                  description: 'Events',
                  content: { 'text/event-stream': {} },
                },
              },
            },
          },
        },
      }),
    );
    const client = await rpc(specPath, {
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response('data: one\n\nevent: ping\ndata: two\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    });

    const response = await client.request('GET /events', {});
    const listen = response.data as (
      eventType: string,
    ) => AsyncIterable<string>;
    const messages: string[] = [];
    for await (const data of listen('message')) {
      messages.push(data);
    }

    assert.deepStrictEqual(messages, ['one']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('RPC client rejects the event listener when the stream fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-rpc-bodies-'));
  try {
    const specPath = join(dir, 'openapi.json');
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Events', version: '1.0.0' },
        paths: {
          '/events': {
            get: {
              operationId: 'streamEvents',
              tags: ['events'],
              responses: {
                '200': {
                  description: 'Events',
                  content: { 'text/event-stream': {} },
                },
              },
            },
          },
        },
      }),
    );
    const connectionReset = new Error('connection reset');
    const client = await rpc(specPath, {
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: one\n\n'));
            },
            pull(controller) {
              controller.error(connectionReset);
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    });

    const response = await client.request('GET /events', {});
    const listen = response.data as (
      eventType: string,
    ) => AsyncIterable<string>;
    const received: string[] = [];
    await assert.rejects(
      async () => {
        for await (const data of listen('message')) {
          received.push(data);
        }
      },
      (error) => {
        assert.equal(error, connectionReset);
        return true;
      },
    );
    assert.deepStrictEqual(received, ['one']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
