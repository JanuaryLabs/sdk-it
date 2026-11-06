import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ZodError, z } from 'zod';

import { runNode, workspaceDirectory } from '@sdk-it/testing';

function userSpec(server: string): object {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1.0.0' },
    servers: [{ url: server }],
    tags: [{ name: 'users' }],
    paths: {
      '/users': {
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
                  required: ['name', 'age'],
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
    },
  };
}

/** The API the CLI calls: it records each request, which invalid input never sends. */
async function upstream() {
  const requests: { method?: string; url?: string }[] = [];
  const server = await new HttpServer().start((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end('{}');
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
  return runNode([cliPath, specPath, ...args]);
}

describe('build-op-command: zod validation errors are surfaced', () => {
  test('missing required field prints Invalid input on stderr and exits 2', async () => {
    await using workspace = await workspaceDirectory('build-op-test-');
    await using api = await upstream();

    const result = await mycli(workspace.path, userSpec(api.url), [
      'createUser',
    ]);

    assert.equal(result.exitCode, 2);
    const parsed: { error: boolean; message: string } = JSON.parse(
      result.stderr,
    );
    assert.equal(parsed.error, true);
    assert.equal(parsed.message, 'Invalid input');
    assert.deepEqual(api.requests, []);
  });

  test('wrong type via --input-file exits 2 with Invalid input message', async () => {
    await using workspace = await workspaceDirectory('build-op-test-');
    await using api = await upstream();
    const bodyPath = join(workspace.path, 'body.json');
    await writeFile(
      bodyPath,
      JSON.stringify({ name: 123, age: 'not-a-number' }),
    );

    const result = await mycli(workspace.path, userSpec(api.url), [
      'createUser',
      '--input-file',
      bodyPath,
    ]);

    assert.equal(result.exitCode, 2);
    const parsed: { error: boolean; message: string } = JSON.parse(
      result.stderr,
    );
    assert.equal(parsed.error, true);
    assert.equal(parsed.message, 'Invalid input');
    assert.deepEqual(api.requests, []);
  });

  test('multi-issue scenario via --input-file still surfaces Invalid input', async () => {
    await using workspace = await workspaceDirectory('build-op-test-');
    await using api = await upstream();
    const bodyPath = join(workspace.path, 'body.json');
    await writeFile(bodyPath, JSON.stringify({ name: 42, age: 'x' }));

    const result = await mycli(workspace.path, userSpec(api.url), [
      'createUser',
      '--input-file',
      bodyPath,
    ]);

    assert.equal(result.exitCode, 2);
    const parsed: { message: string } = JSON.parse(result.stderr);
    assert.equal(parsed.message, 'Invalid input');
    assert.deepEqual(api.requests, []);
  });
});

describe('ZodError invariants build-op-command relies on', () => {
  test('ZodError thrown by safeParse has issues array with code/path/message', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = schema.safeParse({ age: 'no' });
    assert.equal(result.success, false);
    if (result.success) return;

    assert.ok(result.error instanceof ZodError);
    assert.ok(Array.isArray(result.error.issues));
    assert.equal(result.error.issues.length, 2);

    for (const issue of result.error.issues) {
      assert.equal(typeof issue.code, 'string');
      assert.ok(Array.isArray(issue.path));
      assert.equal(typeof issue.message, 'string');
    }

    const nameIssue = result.error.issues.find((i) => i.path[0] === 'name');
    const ageIssue = result.error.issues.find((i) => i.path[0] === 'age');
    assert.ok(nameIssue);
    assert.ok(ageIssue);
    assert.equal(nameIssue.code, 'invalid_type');
    assert.equal(ageIssue.code, 'invalid_type');
  });

  test('ZodError for enum mismatch uses an enum-violation code', () => {
    const schema = z.object({ sort: z.enum(['asc', 'desc']) });
    const result = schema.safeParse({ sort: 'bogus' });
    assert.equal(result.success, false);
    if (result.success) return;

    const issue = result.error.issues[0];
    assert.deepEqual(issue.path, ['sort']);
    assert.equal(
      issue.code,
      'invalid_value',
      `expected enum-violation code, got ${issue.code}`,
    );
  });
});
