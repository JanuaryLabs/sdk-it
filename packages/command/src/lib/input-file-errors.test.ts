import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { command } from '@sdk-it/command';
import { ttyStdin } from '@sdk-it/testing';

const usersSpec = {
  openapi: '3.1.0',
  info: { title: 'Users', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
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

test('an --input-file that does not exist fails with the path and the read error, and sends nothing', async (t) => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-command-input-missing-',
  );
  using _tty = ttyStdin();
  const specPath = join(workspace.path, 'openapi.json');
  await writeFile(specPath, JSON.stringify(usersSpec));
  const bodyPath = join(workspace.path, 'missing.json');
  const program = await command(specPath, {
    name: 'users',
    fetch: () => {
      throw new Error('fetch must not be called');
    },
  });
  program.exitOverride();
  const stderr = t.mock.method(process.stderr, 'write', () => true);

  await program.parseAsync([
    'node',
    'users',
    'createUser',
    '--input-file',
    bodyPath,
  ]);
  stderr.mock.restore();

  const { message, ...printed } = JSON.parse(
    stderr.mock.calls.map((call) => String(call.arguments[0])).join(''),
  );
  assert.deepStrictEqual(printed, { error: true, name: 'Error' });
  assert.ok(
    message.startsWith(`Failed to read JSON from ${bodyPath}: `),
    message,
  );
  assert.match(message, /ENOENT/);
  assert.equal(process.exitCode, 2);
});

test('an --input-file that is not valid JSON fails with the path and the parse error, and sends nothing', async (t) => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-command-input-invalid-',
  );
  using _tty = ttyStdin();
  const specPath = join(workspace.path, 'openapi.json');
  await writeFile(specPath, JSON.stringify(usersSpec));
  const bodyPath = join(workspace.path, 'body.json');
  await writeFile(bodyPath, '{"name": ');
  const program = await command(specPath, {
    name: 'users',
    fetch: () => {
      throw new Error('fetch must not be called');
    },
  });
  program.exitOverride();
  const stderr = t.mock.method(process.stderr, 'write', () => true);

  await program.parseAsync([
    'node',
    'users',
    'createUser',
    '--input-file',
    bodyPath,
  ]);
  stderr.mock.restore();

  const { message, ...printed } = JSON.parse(
    stderr.mock.calls.map((call) => String(call.arguments[0])).join(''),
  );
  assert.deepStrictEqual(printed, { error: true, name: 'Error' });
  assert.ok(
    message.startsWith(`Failed to read JSON from ${bodyPath}: `),
    message,
  );
  assert.match(
    message.slice(`Failed to read JSON from ${bodyPath}: `.length),
    /JSON/,
  );
  assert.equal(process.exitCode, 2);
});
