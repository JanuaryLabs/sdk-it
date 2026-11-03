import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type TestContext, describe, test } from 'node:test';
import { ZodError, z } from 'zod';

import { command } from '@sdk-it/command';
import { ttyStdin } from '@sdk-it/testing';

async function specFile(spec: object) {
  await using pending = new AsyncDisposableStack();
  const directory = pending.use(
    await new TemporaryFiles().directory('build-op-test-'),
  );
  const specPath = join(directory.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));
  pending.move();
  return { ...directory, specPath };
}

function userSpec(): object {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1.0.0' },
    servers: [{ url: 'http://localhost:3000' }],
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

async function stderrOf(t: TestContext, action: () => Promise<unknown>) {
  const stderr = t.mock.method(process.stderr, 'write', () => true);
  const stdout = t.mock.method(process.stdout, 'write', () => true);
  await action();
  stdout.mock.restore();
  stderr.mock.restore();
  return stderr.mock.calls.map((call) => String(call.arguments[0])).join('');
}

async function noFetch(): Promise<Response> {
  throw new Error('fetch should not be invoked for invalid input');
}

describe('build-op-command: zod validation errors are surfaced', () => {
  test('missing required field prints Invalid input on stderr and exits 2', async (t) => {
    using _tty = ttyStdin();
    await using spec = await specFile(userSpec());
    const program = await command(spec.specPath, {
      name: 'mycli',
      fetch: noFetch,
    });
    program.exitOverride();

    const stderr = await stderrOf(t, () =>
      program.parseAsync(['node', 'mycli', 'createUser']),
    );

    assert.equal(process.exitCode, 2);
    const parsed: { error: boolean; message: string } = JSON.parse(stderr);
    assert.equal(parsed.error, true);
    assert.equal(parsed.message, 'Invalid input');
  });

  test('wrong type via --input-file exits 2 with Invalid input message', async (t) => {
    using _tty = ttyStdin();
    await using spec = await specFile(userSpec());
    const bodyPath = join(spec.path, 'body.json');
    await writeFile(
      bodyPath,
      JSON.stringify({ name: 123, age: 'not-a-number' }),
    );

    const program = await command(spec.specPath, {
      name: 'mycli',
      fetch: noFetch,
    });
    program.exitOverride();

    const stderr = await stderrOf(t, () =>
      program.parseAsync([
        'node',
        'mycli',
        'createUser',
        '--input-file',
        bodyPath,
      ]),
    );

    assert.equal(process.exitCode, 2);
    const parsed: { error: boolean; message: string } = JSON.parse(stderr);
    assert.equal(parsed.error, true);
    assert.equal(parsed.message, 'Invalid input');
  });

  test('multi-issue scenario via --input-file still surfaces Invalid input', async (t) => {
    using _tty = ttyStdin();
    await using spec = await specFile(userSpec());
    const bodyPath = join(spec.path, 'body.json');
    await writeFile(bodyPath, JSON.stringify({ name: 42, age: 'x' }));

    const program = await command(spec.specPath, {
      name: 'mycli',
      fetch: noFetch,
    });
    program.exitOverride();

    const stderr = await stderrOf(t, () =>
      program.parseAsync([
        'node',
        'mycli',
        'createUser',
        '--input-file',
        bodyPath,
      ]),
    );

    assert.equal(process.exitCode, 2);
    const parsed: { message: string } = JSON.parse(stderr);
    assert.equal(parsed.message, 'Invalid input');
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
