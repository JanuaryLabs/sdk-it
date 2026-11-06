import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { runNode, workspaceDirectory } from '@sdk-it/testing';

function usersSpec(server: string): object {
  return {
    openapi: '3.1.0',
    info: { title: 'Users', version: '1.0.0' },
    servers: [{ url: server }],
    paths: {
      '/users': {
        post: {
          operationId: 'createUser',
          'x-fn-name': 'createUser',
          tags: ['users'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
    },
  };
}

/** The API the CLI calls: it records each request, which a failed read never sends. */
async function upstream() {
  const requests: { method?: string; url?: string }[] = [];
  const server = await new HttpServer().start((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.writeHead(201);
    response.end();
  });
  return {
    url: server.origin,
    requests,
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/** Runs `users …args` for `spec` as a shell does, with an empty stdin. */
async function users(directory: string, spec: object, args: string[]) {
  const specPath = join(directory, 'openapi.json');
  const cliPath = join(directory, 'users.mjs');
  await writeFile(specPath, JSON.stringify(spec));
  await writeFile(
    cliPath,
    `import { command } from '@sdk-it/command';
const [spec, ...args] = process.argv.slice(2);
const program = await command(spec, { name: 'users' });
await program.parseAsync(['node', 'users', ...args]);
`,
  );
  return runNode([cliPath, specPath, ...args]);
}

test('an --input-file that does not exist fails with the path and the read error, and sends nothing', async () => {
  await using workspace = await workspaceDirectory(
    'sdk-it-command-input-missing-',
  );
  await using api = await upstream();
  const bodyPath = join(workspace.path, 'missing.json');

  const result = await users(workspace.path, usersSpec(api.url), [
    'createUser',
    '--input-file',
    bodyPath,
  ]);

  const { message, ...printed } = JSON.parse(result.stderr);
  assert.deepStrictEqual(printed, { error: true, name: 'Error' });
  assert.ok(
    message.startsWith(`Failed to read JSON from ${bodyPath}: `),
    message,
  );
  assert.match(message, /ENOENT/);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(api.requests, []);
});

test('an --input-file that is not valid JSON fails with the path and the parse error, and sends nothing', async () => {
  await using workspace = await workspaceDirectory(
    'sdk-it-command-input-invalid-',
  );
  await using api = await upstream();
  const bodyPath = join(workspace.path, 'body.json');
  await writeFile(bodyPath, '{"name": ');

  const result = await users(workspace.path, usersSpec(api.url), [
    'createUser',
    '--input-file',
    bodyPath,
  ]);

  const { message, ...printed } = JSON.parse(result.stderr);
  assert.deepStrictEqual(printed, { error: true, name: 'Error' });
  assert.ok(
    message.startsWith(`Failed to read JSON from ${bodyPath}: `),
    message,
  );
  assert.match(
    message.slice(`Failed to read JSON from ${bodyPath}: `.length),
    /JSON/,
  );
  assert.equal(result.exitCode, 2);
  assert.deepEqual(api.requests, []);
});
