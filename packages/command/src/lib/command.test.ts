import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { describe, test } from 'node:test';

import { workspaceDirectory } from '@sdk-it/testing';

function baseSpec(server: string): object {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1.0.0' },
    servers: [{ url: server }],
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

/** The API the CLI calls: it records each request and answers 200 with `{ ok: true }`. */
async function upstream() {
  const requests: {
    method?: string;
    url: URL;
    authorization?: string;
    body: string;
  }[] = [];
  const server = await new HttpServer().start(async (request, response) => {
    const body = await text(request);
    requests.push({
      method: request.method,
      url: new URL(request.url ?? '', `http://${request.headers.host}`),
      authorization: request.headers.authorization,
      body,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  return {
    url: server.origin,
    requests,
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/** Runs `mycli …args` for `spec` as a shell does, with an empty stdin. */
async function mycli(directory: string, spec: object, args: string[]) {
  const specPath = join(directory, 'spec.json');
  const cliPath = join(directory, 'mycli.mjs');
  await writeFile(specPath, JSON.stringify(spec));
  await writeFile(
    cliPath,
    `import { command } from '@sdk-it/command';
const [spec, ...args] = process.argv.slice(2);
const program = await command(spec, { name: 'mycli' });
await program.parseAsync(['node', 'mycli', ...args]);
`,
  );
  const child = spawn(process.execPath, [cliPath, specPath, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = text(child.stdout);
  const stderr = text(child.stderr);
  child.stdin.end();
  const [exitCode] = await once(child, 'close');
  return { exitCode, stdout: await stdout, stderr: await stderr };
}

describe('command()', () => {
  test('GET with query flags sends correct request', async () => {
    await using workspace = await workspaceDirectory('command-test-');
    await using api = await upstream();

    const result = await mycli(workspace.path, baseSpec(api.url), [
      'listUsers',
      '--limit',
      '5',
      '--sort',
      'asc',
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(api.requests.length, 1);
    const req = api.requests[0];
    assert.equal(req.method, 'GET');
    assert.equal(req.url.pathname, '/users');
    assert.equal(req.url.searchParams.get('limit'), '5');
    assert.equal(req.url.searchParams.get('sort'), 'asc');
  });

  test('GET with path param binds implicitly', async () => {
    await using workspace = await workspaceDirectory('command-test-');
    await using api = await upstream();

    const result = await mycli(workspace.path, baseSpec(api.url), [
      'getUser',
      '--userId',
      'u_42',
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].url.pathname, '/users/u_42');
  });

  test('POST body from flags', async () => {
    await using workspace = await workspaceDirectory('command-test-');
    await using api = await upstream();

    const result = await mycli(workspace.path, baseSpec(api.url), [
      'createUser',
      '--name',
      'Alice',
      '--age',
      '30',
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(api.requests.length, 1);
    const req = api.requests[0];
    assert.equal(req.method, 'POST');
    assert.deepEqual(JSON.parse(req.body), { name: 'Alice', age: 30 });
  });

  test('POST body from --input-file', async () => {
    await using workspace = await workspaceDirectory('command-test-');
    await using api = await upstream();
    const bodyPath = join(workspace.path, 'body.json');
    await writeFile(bodyPath, JSON.stringify({ name: 'Bob', age: 25 }));

    const result = await mycli(workspace.path, baseSpec(api.url), [
      'createUser',
      '--input-file',
      bodyPath,
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(api.requests.length, 1);
    assert.deepEqual(JSON.parse(api.requests[0].body), {
      name: 'Bob',
      age: 25,
    });
  });

  test('flags override --input-file', async () => {
    await using workspace = await workspaceDirectory('command-test-');
    await using api = await upstream();
    const bodyPath = join(workspace.path, 'body.json');
    await writeFile(bodyPath, JSON.stringify({ name: 'Bob', age: 25 }));

    const result = await mycli(workspace.path, baseSpec(api.url), [
      'createUser',
      '--input-file',
      bodyPath,
      '--name',
      'Carol',
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(api.requests[0].body), {
      name: 'Carol',
      age: 25,
    });
  });

  test('schema subcommand emits JSON with all ops', async () => {
    await using workspace = await workspaceDirectory('command-test-');

    const result = await mycli(
      workspace.path,
      baseSpec('http://localhost:3000'),
      ['schema'],
    );

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.listUsers, 'listUsers in schema');
    assert.ok(parsed.createUser, 'createUser in schema');
    assert.ok(parsed.getUser, 'getUser in schema');
    assert.equal(parsed.listUsers.method, 'GET');
    assert.equal(parsed.listUsers.path, '/users');
    assert.ok(parsed.listUsers.input.properties.limit);
  });

  test('--describe prints one operation schema', async () => {
    await using workspace = await workspaceDirectory('command-test-');

    const result = await mycli(
      workspace.path,
      baseSpec('http://localhost:3000'),
      ['listUsers', '--describe'],
    );

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.name, 'listUsers');
    assert.equal(parsed.method, 'GET');
    assert.ok(parsed.input.properties.limit);
  });

  test('--base-url overrides ir server', async () => {
    await using workspace = await workspaceDirectory('command-test-');
    await using specServer = await upstream();
    await using override = await upstream();

    const result = await mycli(workspace.path, baseSpec(specServer.url), [
      '--base-url',
      override.url,
      'listUsers',
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(override.requests.length, 1);
    assert.equal(specServer.requests.length, 0);
  });

  test('--token sets Authorization: Bearer header', async () => {
    await using workspace = await workspaceDirectory('command-test-');
    await using api = await upstream();

    const result = await mycli(workspace.path, baseSpec(api.url), [
      '--token',
      'secret',
      'listUsers',
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(api.requests[0].authorization, 'Bearer secret');
  });
});
