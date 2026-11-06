import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { command } from '@sdk-it/command';
import { ttyStdin } from '@sdk-it/testing';

const usersSpec = {
  openapi: '3.1.0',
  info: { title: 'Users', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users/{userId}': {
      get: {
        operationId: 'getUser',
        'x-fn-name': 'getUser',
        tags: ['users'],
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
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '404': {
            description: 'Not found',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/users': {
      post: {
        operationId: 'createUser',
        'x-fn-name': 'createUser',
        tags: ['users'],
        responses: { '201': { description: 'Created' } },
      },
    },
  },
};

test('an HTTP failure prints its status, body, message and name to stderr and exits 1', async (t) => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-command-error-',
  );
  using _tty = ttyStdin();
  const specPath = join(workspace.path, 'openapi.json');
  await writeFile(specPath, JSON.stringify(usersSpec));
  const program = await command(specPath, {
    name: 'users',
    fetch: async () =>
      Response.json({ message: 'User u_7 not found' }, { status: 404 }),
  });
  program.exitOverride();
  const stderr = t.mock.method(process.stderr, 'write', () => true);

  await program.parseAsync(['node', 'users', 'getUser', '--userId', 'u_7']);
  stderr.mock.restore();

  assert.deepStrictEqual(
    JSON.parse(
      stderr.mock.calls.map((call) => String(call.arguments[0])).join(''),
    ),
    {
      error: true,
      status: 404,
      data: { message: 'User u_7 not found' },
      message:
        'Request failed with status code 404: {"message":"User u_7 not found"}',
      name: 'APIError',
    },
  );
  assert.equal(process.exitCode, 1);
});

test('an operation that declares no response content succeeds and prints nothing', async (t) => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-command-bodyless-',
  );
  const exitCode = process.exitCode;
  using _tty = ttyStdin();
  const specPath = join(workspace.path, 'openapi.json');
  await writeFile(specPath, JSON.stringify(usersSpec));
  const program = await command(specPath, {
    name: 'users',
    fetch: async () => new Response(null, { status: 201 }),
  });
  program.exitOverride();
  const stdout = t.mock.method(process.stdout, 'write', () => true);
  const stderr = t.mock.method(process.stderr, 'write', () => true);

  await program.parseAsync(['node', 'users', 'createUser']);
  stderr.mock.restore();
  stdout.mock.restore();

  assert.equal(
    [...stdout.mock.calls, ...stderr.mock.calls]
      .map((call) => String(call.arguments[0]))
      .join(''),
    '',
  );
  assert.equal(process.exitCode, exitCode);
});

test('a fetch that fails with an Error from another realm prints its name and message to stderr', async (t) => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-command-realm-',
  );
  using _tty = ttyStdin();
  const specPath = join(workspace.path, 'openapi.json');
  await writeFile(specPath, JSON.stringify(usersSpec));
  const program = await command(specPath, {
    name: 'users',
    fetch: () =>
      Promise.reject(runInNewContext('new TypeError("network down")')),
  });
  program.exitOverride();
  const stderr = t.mock.method(process.stderr, 'write', () => true);

  await program.parseAsync(['node', 'users', 'getUser', '--userId', 'u_7']);
  stderr.mock.restore();

  assert.deepStrictEqual(
    JSON.parse(
      stderr.mock.calls.map((call) => String(call.arguments[0])).join(''),
    ),
    { error: true, message: 'network down', name: 'TypeError' },
  );
  assert.equal(process.exitCode, 1);
});
