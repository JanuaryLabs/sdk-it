import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';

import { workspaceDirectory } from '@sdk-it/testing';

function usersSpec(server: string): object {
  return {
    openapi: '3.1.0',
    info: { title: 'Users', version: '1.0.0' },
    servers: [{ url: server }],
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
}

/** The API the CLI calls: `answer` writes each response. */
async function upstream(answer: (response: ServerResponse) => void) {
  const server = await new HttpServer().start((_request, response) => {
    answer(response);
  });
  return {
    url: server.origin,
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/** The CLI's entry script; `options` is the source of its extra `command()` options. */
function entry(options = '') {
  return `import { command } from '@sdk-it/command';
import { runInNewContext } from 'node:vm';
const [spec, ...args] = process.argv.slice(2);
const program = await command(spec, { name: 'users', ${options} });
await program.parseAsync(['node', 'users', ...args]);
`;
}

/** Runs `users …args` for `spec` as a shell does, with an empty stdin. */
async function users(
  directory: string,
  spec: object,
  args: string[],
  cli = entry(),
) {
  const specPath = join(directory, 'openapi.json');
  const cliPath = join(directory, 'users.mjs');
  await writeFile(specPath, JSON.stringify(spec));
  await writeFile(cliPath, cli);
  const child = spawn(process.execPath, [cliPath, specPath, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = text(child.stdout);
  const stderr = text(child.stderr);
  child.stdin.end();
  const [exitCode] = await once(child, 'close');
  return { exitCode, stdout: await stdout, stderr: await stderr };
}

test('an HTTP failure prints its status, body, message and name to stderr and exits 1', async () => {
  await using workspace = await workspaceDirectory('sdk-it-command-error-');
  await using api = await upstream((response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'User u_7 not found' }));
  });

  const result = await users(workspace.path, usersSpec(api.url), [
    'getUser',
    '--userId',
    'u_7',
  ]);

  assert.deepStrictEqual(JSON.parse(result.stderr), {
    error: true,
    status: 404,
    data: { message: 'User u_7 not found' },
    message:
      'Request failed with status code 404: {"message":"User u_7 not found"}',
    name: 'APIError',
  });
  assert.equal(result.exitCode, 1);
});

test('an operation that declares no response content succeeds and prints nothing', async () => {
  await using workspace = await workspaceDirectory('sdk-it-command-bodyless-');
  await using api = await upstream((response) => {
    response.writeHead(201);
    response.end();
  });

  const result = await users(workspace.path, usersSpec(api.url), [
    'createUser',
  ]);

  assert.equal(result.stdout + result.stderr, '');
  assert.equal(result.exitCode, 0);
});

test('a fetch that fails with an Error from another realm prints its name and message to stderr', async () => {
  await using workspace = await workspaceDirectory('sdk-it-command-realm-');

  const result = await users(
    workspace.path,
    usersSpec('https://api.example.com'),
    ['getUser', '--userId', 'u_7'],
    entry(
      `fetch: () => Promise.reject(runInNewContext('new TypeError("network down")')),`,
    ),
  );

  assert.deepStrictEqual(JSON.parse(result.stderr), {
    error: true,
    message: 'network down',
    name: 'TypeError',
  });
  assert.equal(result.exitCode, 1);
});
