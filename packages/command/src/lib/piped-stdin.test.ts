import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';

import { runNode, workspaceDirectory } from '@sdk-it/testing';

const spec = {
  openapi: '3.1.0',
  info: { title: 'Acme', version: '1.0.0' },
  paths: {
    '/users': {
      post: {
        operationId: 'createUser',
        'x-fn-name': 'createUser',
        tags: ['users'],
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
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
};

/** The API the CLI calls: it records each request and answers 201 with its body. */
async function upstream() {
  const requests: { method?: string; url?: string; body: string }[] = [];
  const server = await new HttpServer().start(async (request, response) => {
    const body = await text(request);
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(body);
  });
  return {
    url: server.origin,
    requests,
    bodies: () => requests.map(({ body }): unknown => JSON.parse(body)),
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/** Runs `acme createUser …args` the way a shell pipe does: `stdin` is its stdin. */
async function pipe(baseUrl: string, stdin: string, args: string[] = []) {
  await using directory = await workspaceDirectory('piped-stdin-');
  const specPath = join(directory.path, 'spec.json');
  const cliPath = join(directory.path, 'acme.mjs');
  await writeFile(specPath, JSON.stringify(spec));
  await writeFile(
    cliPath,
    `import { command } from '@sdk-it/command';
const [spec, baseUrl, ...args] = process.argv.slice(2);
const program = await command(spec, { name: 'acme', baseUrl });
await program.parseAsync(['node', 'acme', ...args]);
`,
  );
  return await runNode([cliPath, specPath, baseUrl, 'createUser', ...args], {
    stdin,
  });
}

test('invalid JSON on stdin is refused before any request', async () => {
  await using api = await upstream();

  const result = await pipe(api.url, '{"name": "Ada",');

  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  const error: { error: boolean; message: string } = JSON.parse(result.stderr);
  assert.equal(error.error, true);
  assert.match(error.message, /^Failed to parse JSON from stdin: /);
  assert.deepEqual(api.bodies(), []);
});

test('empty piped stdin leaves the input to the flags', async () => {
  await using api = await upstream();

  const result = await pipe(api.url, '', ['--name', 'Ada', '--age', '36']);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(api.bodies(), [{ name: 'Ada', age: 36 }]);
});

test('whitespace-only piped stdin, as `echo |` sends, leaves the input to the flags', async () => {
  await using api = await upstream();

  const result = await pipe(api.url, '\n', ['--name', 'Ada', '--age', '36']);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(api.bodies(), [{ name: 'Ada', age: 36 }]);
});

test('a UTF-8 byte order mark and whitespace around the piped JSON are tolerated', async () => {
  await using api = await upstream();

  const result = await pipe(api.url, '\uFEFF \n{"name":"Ada","age":36}\n');

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(api.bodies(), [{ name: 'Ada', age: 36 }]);
});

test('a piped JSON object becomes the request body and the response is printed', async () => {
  await using api = await upstream();

  const result = await pipe(api.url, '{"name":"Ada","age":36}');

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(
    api.requests.map(({ method, url }) => `${method} ${url}`),
    ['POST /users'],
  );
  assert.deepEqual(api.bodies(), [{ name: 'Ada', age: 36 }]);
  assert.deepEqual(JSON.parse(result.stdout), { name: 'Ada', age: 36 });
});

test('non-ASCII text on stdin reaches the API unchanged', async () => {
  await using api = await upstream();

  const result = await pipe(api.url, '{"name":"Zoë 東京 🚀","age":36}');

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(api.bodies(), [{ name: 'Zoë 東京 🚀', age: 36 }]);
});

test('a body larger than the pipe buffer reaches the API whole, across reads that split characters', async () => {
  await using api = await upstream();
  // 300 KB of 3-byte characters: the 64 KB pipe buffer makes the CLI read it in
  // several chunks, and most chunk ends fall inside a character.
  const name = '東'.repeat(100_000);

  const result = await pipe(api.url, JSON.stringify({ name, age: 36 }));

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(api.bodies(), [{ name, age: 36 }]);
});

test('a flag overrides the same key piped on stdin', async () => {
  await using api = await upstream();

  const result = await pipe(api.url, '{"name":"Ada","age":36}', [
    '--age',
    '37',
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(api.bodies(), [{ name: 'Ada', age: 37 }]);
});
