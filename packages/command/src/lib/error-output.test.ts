import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { command } from '@sdk-it/command';

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

test('an HTTP failure prints its status, body, message and name to stderr and exits 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-command-error-'));
  const stdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const writeStderr = process.stderr.write;
  const exitCode = process.exitCode;
  let stderr = '';
  try {
    const specPath = join(dir, 'openapi.json');
    await writeFile(specPath, JSON.stringify(usersSpec));
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    const program = await command(specPath, {
      name: 'users',
      fetch: async () =>
        Response.json({ message: 'User u_7 not found' }, { status: 404 }),
    });
    program.exitOverride();
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    };

    await program.parseAsync(['node', 'users', 'getUser', '--userId', 'u_7']);

    assert.deepStrictEqual(JSON.parse(stderr), {
      error: true,
      status: 404,
      data: { message: 'User u_7 not found' },
      message:
        'Request failed with status code 404: {"message":"User u_7 not found"}',
      name: 'APIError',
    });
    assert.equal(process.exitCode, 1);
  } finally {
    process.stderr.write = writeStderr;
    process.exitCode = exitCode;
    if (stdin) {
      Object.defineProperty(process.stdin, 'isTTY', stdin);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('an operation that declares no response content succeeds and prints nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-command-bodyless-'));
  const stdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const writeStdout = process.stdout.write;
  const writeStderr = process.stderr.write;
  const exitCode = process.exitCode;
  let output = '';
  try {
    const specPath = join(dir, 'openapi.json');
    await writeFile(specPath, JSON.stringify(usersSpec));
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    const program = await command(specPath, {
      name: 'users',
      fetch: async () => new Response(null, { status: 201 }),
    });
    program.exitOverride();
    process.stdout.write = process.stderr.write = (
      chunk: string | Uint8Array,
    ) => {
      output += String(chunk);
      return true;
    };

    await program.parseAsync(['node', 'users', 'createUser']);

    assert.equal(output, '');
    assert.equal(process.exitCode, exitCode);
  } finally {
    process.stdout.write = writeStdout;
    process.stderr.write = writeStderr;
    process.exitCode = exitCode;
    if (stdin) {
      Object.defineProperty(process.stdin, 'isTTY', stdin);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
