import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  Dispatcher,
  type Interceptor,
  Ok,
  type RequestConfig,
  createBaseUrlInterceptor,
  createHeadersInterceptor,
  fetchType,
  rpc,
} from '@sdk-it/rpc';

function specFile(spec: object) {
  const dir = mkdtempSync(join(tmpdir(), 'rpc-v4-test-'));
  const path = join(dir, 'spec.json');
  writeFileSync(path, JSON.stringify(spec));
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const okSpec = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000' }],
  tags: [
    {
      name: 'users',
      'x-name': 'User Agent',
      'x-instructions': 'Handle users',
      'x-handoff-description': 'User ops',
    },
  ],
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        'x-fn-name': 'listUsers',
        tags: ['users'],
        parameters: [],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    },
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Client options: token resolution', () => {
  test('token as string: emits Authorization: Bearer <string>', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        token: 'abc123',
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});

      assert.ok(received);
      assert.equal(received.headers.get('authorization'), 'Bearer abc123');
    } finally {
      spec.cleanup();
    }
  });

  test('token as sync function: re-evaluated for every client.request call', async () => {
    const spec = specFile(okSpec);
    try {
      let current = 'first';
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        token: () => current,
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.equal(received?.headers.get('authorization'), 'Bearer first');

      current = 'second';
      await client.request('GET /users', {});
      assert.equal(received?.headers.get('authorization'), 'Bearer second');
    } finally {
      spec.cleanup();
    }
  });

  test('token as async function: awaited before Authorization header is set', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        token: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return 'async-token';
        },
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.equal(
        received?.headers.get('authorization'),
        'Bearer async-token',
      );
    } finally {
      spec.cleanup();
    }
  });

  test('token omitted: no Authorization header on outbound request', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.equal(received?.headers.get('authorization'), null);
    } finally {
      spec.cleanup();
    }
  });
});

describe('Client options: baseUrl resolution', () => {
  test('baseUrl as string: used verbatim', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        baseUrl: 'http://api.example.com',
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.ok(received?.url.startsWith('http://api.example.com/users'));
    } finally {
      spec.cleanup();
    }
  });

  test('baseUrl as sync function: invoked per request', async () => {
    const spec = specFile(okSpec);
    try {
      let current = 'http://a.example.com';
      const urls: string[] = [];
      const client = await rpc(spec.path, {
        baseUrl: () => current,
        fetch: async (req) => {
          urls.push(req.url);
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      current = 'http://b.example.com';
      await client.request('GET /users', {});

      assert.ok(urls[0].startsWith('http://a.example.com/users'));
      assert.ok(urls[1].startsWith('http://b.example.com/users'));
    } finally {
      spec.cleanup();
    }
  });

  test('baseUrl as async function: awaited', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        baseUrl: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return 'http://async.example.com';
        },
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.ok(received?.url.startsWith('http://async.example.com/users'));
    } finally {
      spec.cleanup();
    }
  });

  test('baseUrl falls back to spec servers[0].url when not provided', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.ok(received?.url.startsWith('http://localhost:3000/users'));
    } finally {
      spec.cleanup();
    }
  });
});

describe('Client options: custom fetch shim', () => {
  test('custom fetch is invoked with a Request instance', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [{ id: 1 }] });
        },
      });

      const resp = await client.request('GET /users', {});
      assert.ok(received instanceof Request);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, { users: [{ id: 1 }] });
    } finally {
      spec.cleanup();
    }
  });

  test('fetch undefined: Dispatcher falls back to global fetch', async () => {
    const original = globalThis.fetch;
    let called = 0;
    let receivedReq: Request | undefined;
    globalThis.fetch = (async (input: Request) => {
      called += 1;
      receivedReq = input as Request;
      return jsonResponse({ users: [] });
    }) as typeof fetch;

    try {
      const dispatcher = new Dispatcher([], undefined);
      const config: RequestConfig = {
        url: new URL('http://example.com/users'),
        init: { method: 'GET', headers: new Headers() },
      };
      const resp = await dispatcher.send(config, [Ok]);

      assert.equal(called, 1);
      assert.ok(receivedReq);
      assert.equal(resp.status, 200);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('Client options: headers record', () => {
  test('flat string-record headers are merged onto outbound request', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        headers: {
          'X-Tenant-Id': 'acme',
          'X-Request-Source': 'test',
        },
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.equal(received?.headers.get('x-tenant-id'), 'acme');
      assert.equal(received?.headers.get('x-request-source'), 'test');
    } finally {
      spec.cleanup();
    }
  });

  test('headers omitted: only operation defaults present', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', {});
      assert.equal(received?.headers.get('x-tenant-id'), null);
    } finally {
      spec.cleanup();
    }
  });

  test('per-request headers override client-level headers', async () => {
    const spec = specFile(okSpec);
    try {
      let received: Request | undefined;
      const client = await rpc(spec.path, {
        headers: { 'X-Tenant-Id': 'default' },
        fetch: async (req) => {
          received = req;
          return jsonResponse({ users: [] });
        },
      });

      await client.request(
        'GET /users',
        {},
        { headers: { 'X-Tenant-Id': 'override' } },
      );
      assert.equal(received?.headers.get('x-tenant-id'), 'override');
    } finally {
      spec.cleanup();
    }
  });
});

describe('Dispatcher interceptors', () => {
  test('before interceptors fire in declaration order', async () => {
    const order: string[] = [];
    const interceptors: Interceptor[] = [
      {
        before: (config) => {
          order.push('before-1');
          return config;
        },
      },
      {
        before: (config) => {
          order.push('before-2');
          return config;
        },
      },
    ];

    const dispatcher = new Dispatcher(interceptors, async () =>
      jsonResponse({ ok: true }),
    );
    await dispatcher.send(
      {
        url: new URL('http://example.com/x'),
        init: { method: 'GET', headers: new Headers() },
      },
      [Ok],
    );

    assert.deepEqual(order, ['before-1', 'before-2']);
  });

  test('after interceptors fire in reverse order', async () => {
    const order: string[] = [];
    const interceptors: Interceptor[] = [
      {
        after: (resp) => {
          order.push('after-1');
          return resp;
        },
      },
      {
        after: (resp) => {
          order.push('after-2');
          return resp;
        },
      },
    ];

    const dispatcher = new Dispatcher(interceptors, async () =>
      jsonResponse({ ok: true }),
    );
    await dispatcher.send(
      {
        url: new URL('http://example.com/x'),
        init: { method: 'GET', headers: new Headers() },
      },
      [Ok],
    );

    assert.deepEqual(order, ['after-2', 'after-1']);
  });

  test('before interceptor can mutate the URL (used by baseUrl interceptor)', async () => {
    let received: Request | undefined;
    const dispatcher = new Dispatcher(
      [createBaseUrlInterceptor('http://rewritten.example.com')],
      async (req) => {
        received = req;
        return jsonResponse({ ok: true });
      },
    );

    await dispatcher.send(
      {
        url: new URL('/users', 'local://'),
        init: { method: 'GET', headers: new Headers() },
      },
      [Ok],
    );

    assert.ok(received?.url.startsWith('http://rewritten.example.com/users'));
  });

  test('headers interceptor adds headers without overwriting existing values', async () => {
    let received: Request | undefined;
    const headers = new Headers();
    headers.set('x-existing', 'kept');
    const dispatcher = new Dispatcher(
      [
        createHeadersInterceptor(
          { 'x-default': 'd', 'x-existing': 'overwritten' },
          {},
        ),
      ],
      async (req) => {
        received = req;
        return jsonResponse({ ok: true });
      },
    );

    await dispatcher.send(
      {
        url: new URL('http://example.com/x'),
        init: { method: 'GET', headers },
      },
      [Ok],
    );

    assert.equal(received?.headers.get('x-default'), 'd');
    assert.equal(received?.headers.get('x-existing'), 'kept');
  });
});

describe('Dispatcher.send error and parsing paths', () => {
  test('HTTP 4xx: throws an APIError-shaped value with status and parsed data', async () => {
    const dispatcher = new Dispatcher([], async () =>
      jsonResponse({ message: 'nope' }, 404),
    );

    await assert.rejects(
      () =>
        dispatcher.send(
          {
            url: new URL('http://example.com/x'),
            init: { method: 'GET', headers: new Headers() },
          },
          [Ok],
        ),
      (err: any) => {
        assert.equal(err.status, 404);
        assert.deepEqual(err.data, { message: 'nope' });
        return true;
      },
    );
  });

  test('HTTP 5xx: throws with status and parsed data', async () => {
    const dispatcher = new Dispatcher([], async () =>
      jsonResponse({ message: 'boom' }, 500),
    );

    await assert.rejects(
      () =>
        dispatcher.send(
          {
            url: new URL('http://example.com/x'),
            init: { method: 'GET', headers: new Headers() },
          },
          [Ok],
        ),
      (err: any) => {
        assert.equal(err.status, 500);
        assert.deepEqual(err.data, { message: 'boom' });
        return true;
      },
    );
  });

  test('network error in fetch shim: propagates verbatim', async () => {
    const boom = new Error('network down');
    const dispatcher = new Dispatcher([], async () => {
      throw boom;
    });

    await assert.rejects(
      () =>
        dispatcher.send(
          {
            url: new URL('http://example.com/x'),
            init: { method: 'GET', headers: new Headers() },
          },
          [Ok],
        ),
      (err: any) => err === boom,
    );
  });

  test('malformed JSON success body: parser error surfaces', async () => {
    const dispatcher = new Dispatcher([], async () => {
      return new Response('{not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await assert.rejects(() =>
      dispatcher.send(
        {
          url: new URL('http://example.com/x'),
          init: { method: 'GET', headers: new Headers() },
        },
        [Ok],
      ),
    );
  });
});

describe('fetchType schema invariants (v3 → v4 sentinel)', () => {
  test('fetchType.parse returns a callable wrapper for a custom fetch', async () => {
    const wrapped = fetchType.parse(async () => jsonResponse({ ok: true }));
    assert.equal(typeof wrapped, 'function');
    const result = await wrapped!(new Request('http://example.com'));
    assert.ok(result instanceof Response);
  });

  test('fetchType is optional: undefined parses to undefined', () => {
    const parsed = fetchType.parse(undefined);
    assert.equal(parsed, undefined);
  });
});

describe('Client options: callback return-value validation (v3 parity)', () => {
  test('token callback resolving to a non-string rejects with ZodError instead of sending Bearer undefined', async () => {
    const spec = specFile(okSpec);
    try {
      const client = await rpc(spec.path, {
        token: () => undefined as unknown as string,
        fetch: async () => jsonResponse({ users: [] }),
      });

      await assert.rejects(
        client.request('GET /users', {}),
        (err: Error) => err.name === 'ZodError',
        'non-string token must fail fast, not flow into the Authorization header',
      );
    } finally {
      spec.cleanup();
    }
  });

  test('baseUrl callback resolving to a non-string rejects with ZodError', async () => {
    const spec = specFile(okSpec);
    try {
      const client = await rpc(spec.path, {
        baseUrl: () => 42 as unknown as string,
        fetch: async () => jsonResponse({ users: [] }),
      });

      await assert.rejects(
        client.request('GET /users', {}),
        (err: Error) => err.name === 'ZodError',
        'non-string baseUrl must fail fast',
      );
    } finally {
      spec.cleanup();
    }
  });
});

describe('Client.request input validation', () => {
  const specWithRequiredParam = {
    ...okSpec,
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          'x-fn-name': 'listUsers',
          tags: ['users'],
          parameters: [
            {
              name: 'email',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'email' },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': { schema: { type: 'object' } },
              },
            },
          },
        },
      },
    },
  };

  test('invalid input rejects with ParseError before any request is sent', async () => {
    const spec = specFile(specWithRequiredParam);
    try {
      let fetched = false;
      const client = await rpc(spec.path, {
        fetch: async () => {
          fetched = true;
          return jsonResponse({ users: [] });
        },
      });

      await assert.rejects(
        client.request('GET /users', { email: 'not-an-email' }),
        (err: Error) => err.name === 'ParseError',
      );
      assert.equal(fetched, false, 'no request may leave the client');
    } finally {
      spec.cleanup();
    }
  });

  test('valid input dispatches normally', async () => {
    const spec = specFile(specWithRequiredParam);
    try {
      let url: string | undefined;
      const client = await rpc(spec.path, {
        fetch: async (req) => {
          url = req.url;
          return jsonResponse({ users: [] });
        },
      });

      await client.request('GET /users', { email: 'a@b.com' });
      assert.ok(url?.includes('email=a%40b.com'));
    } finally {
      spec.cleanup();
    }
  });
});
