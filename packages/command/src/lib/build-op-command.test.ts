import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ZodError, z } from 'zod';

import { command } from '@sdk-it/command';

function specFile(spec: object) {
  const dir = mkdtempSync(join(tmpdir(), 'build-op-test-'));
  const path = join(dir, 'spec.json');
  writeFileSync(path, JSON.stringify(spec));
  return {
    dir,
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function ttyStdin() {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  });
  process.exitCode = 0;
  return {
    restore: () => {
      if (original) {
        Object.defineProperty(process.stdin, 'isTTY', original);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
      process.exitCode = 0;
    },
  };
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

interface StderrCapture {
  buffer: string;
  restore: () => void;
}

function captureStderr(): StderrCapture {
  const original = process.stderr.write.bind(process.stderr);
  const capture = { buffer: '' } as StderrCapture & { buffer: string };
  (process.stderr as unknown as { write: (c: unknown) => boolean }).write = (
    chunk: unknown,
  ) => {
    capture.buffer += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  };
  capture.restore = () => {
    process.stderr.write = original;
  };
  return capture;
}

function silenceStdout<T>(action: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (c: unknown) => boolean }).write =
    () => true;
  return action().finally(() => {
    process.stdout.write = original;
  });
}

async function noFetch(): Promise<Response> {
  throw new Error('fetch should not be invoked for invalid input');
}

describe('build-op-command: zod validation errors are surfaced', () => {
  test('missing required field prints Invalid input on stderr and exits 2', async () => {
    const tty = ttyStdin();
    const spec = specFile(userSpec());
    try {
      const program = await command(spec.path, {
        name: 'mycli',
        fetch: noFetch as never,
      });
      program.exitOverride();

      const stderr = captureStderr();
      try {
        await silenceStdout(() =>
          program.parseAsync(['node', 'mycli', 'createUser']),
        );
      } finally {
        stderr.restore();
      }

      assert.equal(process.exitCode, 2);
      const parsed = JSON.parse(stderr.buffer) as {
        error: boolean;
        message: string;
      };
      assert.equal(parsed.error, true);
      assert.equal(parsed.message, 'Invalid input');
    } finally {
      spec.cleanup();
      tty.restore();
    }
  });

  test('wrong type via --input-file exits 2 with Invalid input message', async () => {
    const tty = ttyStdin();
    const spec = specFile(userSpec());
    try {
      const bodyPath = join(spec.dir, 'body.json');
      writeFileSync(
        bodyPath,
        JSON.stringify({ name: 123, age: 'not-a-number' }),
      );

      const program = await command(spec.path, {
        name: 'mycli',
        fetch: noFetch as never,
      });
      program.exitOverride();

      const stderr = captureStderr();
      try {
        await silenceStdout(() =>
          program.parseAsync([
            'node',
            'mycli',
            'createUser',
            '--input-file',
            bodyPath,
          ]),
        );
      } finally {
        stderr.restore();
      }

      assert.equal(process.exitCode, 2);
      const parsed = JSON.parse(stderr.buffer) as {
        error: boolean;
        message: string;
      };
      assert.equal(parsed.error, true);
      assert.equal(parsed.message, 'Invalid input');
    } finally {
      spec.cleanup();
      tty.restore();
    }
  });

  test('multi-issue scenario via --input-file still surfaces Invalid input', async () => {
    const tty = ttyStdin();
    const spec = specFile(userSpec());
    try {
      const bodyPath = join(spec.dir, 'body.json');
      writeFileSync(bodyPath, JSON.stringify({ name: 42, age: 'x' }));

      const program = await command(spec.path, {
        name: 'mycli',
        fetch: noFetch as never,
      });
      program.exitOverride();

      const stderr = captureStderr();
      try {
        await silenceStdout(() =>
          program.parseAsync([
            'node',
            'mycli',
            'createUser',
            '--input-file',
            bodyPath,
          ]),
        );
      } finally {
        stderr.restore();
      }

      assert.equal(process.exitCode, 2);
      const parsed = JSON.parse(stderr.buffer) as {
        error: boolean;
        message: string;
      };
      assert.equal(parsed.message, 'Invalid input');
    } finally {
      spec.cleanup();
      tty.restore();
    }
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
