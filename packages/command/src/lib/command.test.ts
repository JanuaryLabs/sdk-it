import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type TestContext, describe, test } from 'node:test';

import { command } from '@sdk-it/command';
import { ttyStdin } from '@sdk-it/testing';

async function writeSpec(spec: object) {
  await using pending = new AsyncDisposableStack();
  const directory = pending.use(
    await new TemporaryFiles().directory('command-test-'),
  );
  const specPath = join(directory.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));
  pending.move();
  return { ...directory, specPath };
}

function baseSpec(): object {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1.0.0' },
    servers: [{ url: 'http://localhost:3000' }],
    tags: [{ name: 'users' }],
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          'x-fn-name': 'listUsers',
          tags: ['users'],
          summary: 'List users',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 10 },
            },
            {
              name: 'active',
              in: 'query',
              required: false,
              schema: { type: 'boolean' },
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['asc', 'desc'] },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { users: { type: 'array' } },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createUser',
          'x-fn-name': 'createUser',
          tags: ['users'],
          summary: 'Create user',
          parameters: [],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    age: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': { schema: { type: 'object' } },
              },
            },
          },
        },
      },
      '/users/{userId}': {
        get: {
          operationId: 'getUser',
          'x-fn-name': 'getUser',
          tags: ['users'],
          summary: 'Get user',
          parameters: [
            {
              name: 'userId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
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
}

function mockFetch() {
  const calls: Request[] = [];
  const fn = async (request: Request) => {
    calls.push(request);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fn };
}

async function silenceStdout(
  t: TestContext,
  action: () => Promise<unknown>,
): Promise<string> {
  const stdout = t.mock.method(process.stdout, 'write', () => true);
  await action();
  stdout.mock.restore();
  return stdout.mock.calls.map((call) => String(call.arguments[0])).join('');
}

describe('command()', () => {
  test('GET with query flags sends correct request', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const { calls, fn } = mockFetch();
    const program = await command(specPath, {
      name: 'mycli',
      fetch: fn,
    });
    program.exitOverride();

    await silenceStdout(t, () =>
      program.parseAsync([
        'node',
        'mycli',
        'listUsers',
        '--limit',
        '5',
        '--sort',
        'asc',
      ]),
    );

    assert.equal(calls.length, 1);
    const req = calls[0];
    assert.equal(req.method, 'GET');
    const url = new URL(req.url);
    assert.equal(url.pathname, '/users');
    assert.equal(url.searchParams.get('limit'), '5');
    assert.equal(url.searchParams.get('sort'), 'asc');
  });

  test('GET with path param binds implicitly', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const { calls, fn } = mockFetch();
    const program = await command(specPath, {
      name: 'mycli',
      fetch: fn,
    });
    program.exitOverride();

    await silenceStdout(t, () =>
      program.parseAsync(['node', 'mycli', 'getUser', '--userId', 'u_42']),
    );

    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/users/u_42');
  });

  test('POST body from flags', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const { calls, fn } = mockFetch();
    const program = await command(specPath, {
      name: 'mycli',
      fetch: fn,
    });
    program.exitOverride();

    await silenceStdout(t, () =>
      program.parseAsync([
        'node',
        'mycli',
        'createUser',
        '--name',
        'Alice',
        '--age',
        '30',
      ]),
    );

    assert.equal(calls.length, 1);
    const req = calls[0];
    assert.equal(req.method, 'POST');
    const body = await req.json();
    assert.deepEqual(body, { name: 'Alice', age: 30 });
  });

  test('POST body from --input-file', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const bodyPath = join(workspace.path, 'body.json');
    await writeFile(bodyPath, JSON.stringify({ name: 'Bob', age: 25 }));
    const { calls, fn } = mockFetch();
    const program = await command(specPath, {
      name: 'mycli',
      fetch: fn,
    });
    program.exitOverride();

    await silenceStdout(t, () =>
      program.parseAsync([
        'node',
        'mycli',
        'createUser',
        '--input-file',
        bodyPath,
      ]),
    );

    assert.equal(calls.length, 1);
    const body = await calls[0].json();
    assert.deepEqual(body, { name: 'Bob', age: 25 });
  });

  test('flags override --input-file', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const bodyPath = join(workspace.path, 'body.json');
    await writeFile(bodyPath, JSON.stringify({ name: 'Bob', age: 25 }));
    const { calls, fn } = mockFetch();
    const program = await command(specPath, {
      name: 'mycli',
      fetch: fn,
    });
    program.exitOverride();

    await silenceStdout(t, () =>
      program.parseAsync([
        'node',
        'mycli',
        'createUser',
        '--input-file',
        bodyPath,
        '--name',
        'Carol',
      ]),
    );

    const body = await calls[0].json();
    assert.deepEqual(body, { name: 'Carol', age: 25 });
  });

  test('schema subcommand emits JSON with all ops', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const program = await command(specPath, { name: 'mycli' });
    program.exitOverride();

    const out = await silenceStdout(t, () =>
      program.parseAsync(['node', 'mycli', 'schema']),
    );
    const parsed = JSON.parse(out);
    assert.ok(parsed.listUsers, 'listUsers in schema');
    assert.ok(parsed.createUser, 'createUser in schema');
    assert.ok(parsed.getUser, 'getUser in schema');
    assert.equal(parsed.listUsers.method, 'GET');
    assert.equal(parsed.listUsers.path, '/users');
    assert.ok(parsed.listUsers.input.properties.limit);
  });

  test('--describe prints one operation schema', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const program = await command(specPath, { name: 'mycli' });
    program.exitOverride();

    const out = await silenceStdout(t, () =>
      program.parseAsync(['node', 'mycli', 'listUsers', '--describe']),
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed.name, 'listUsers');
    assert.equal(parsed.method, 'GET');
    assert.ok(parsed.input.properties.limit);
  });

  test('--base-url overrides ir server', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const { calls, fn } = mockFetch();
    const program = await command(specPath, {
      name: 'mycli',
      fetch: fn,
    });
    program.exitOverride();

    await silenceStdout(t, () =>
      program.parseAsync([
        'node',
        'mycli',
        '--base-url',
        'http://override:9000',
        'listUsers',
      ]),
    );

    const url = new URL(calls[0].url);
    assert.equal(url.origin, 'http://override:9000');
  });

  test('--token sets Authorization: Bearer header', async (t) => {
    using _tty = ttyStdin();
    await using workspace = await writeSpec(baseSpec());
    const specPath = workspace.specPath;
    const { calls, fn } = mockFetch();
    const program = await command(specPath, {
      name: 'mycli',
      fetch: fn,
    });
    program.exitOverride();

    await silenceStdout(t, () =>
      program.parseAsync(['node', 'mycli', '--token', 'secret', 'listUsers']),
    );

    assert.equal(calls[0].headers.get('authorization'), 'Bearer secret');
  });
});
