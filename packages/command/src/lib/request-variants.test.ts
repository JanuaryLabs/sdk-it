import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { workspaceDirectory } from '@sdk-it/testing';

const note: SchemaObject = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
};

const notesSpec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Notes', version: '1.0.0' },
  paths: {
    '/notes': {
      post: {
        operationId: 'createNote',
        requestBody: {
          required: true,
          content: {
            'text/plain': { schema: { type: 'string' } },
            'application/x-www-form-urlencoded': { schema: note },
            'application/json': { schema: note },
          },
        },
        responses: { '204': { description: 'Created' } },
      },
    },
  },
};

/** The API the CLI calls: it records each request and answers 204. */
async function upstream() {
  const requests: {
    method?: string;
    url: string;
    contentType?: string;
    body: string;
  }[] = [];
  const server = await new HttpServer().start(async (request, response) => {
    const body = await text(request);
    requests.push({
      method: request.method,
      url: new URL(request.url ?? '', `http://${request.headers.host}`).href,
      contentType: request.headers['content-type'],
      body,
    });
    response.writeHead(204);
    response.end();
  });
  return {
    url: server.origin,
    requests,
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/** Runs `notes …args` for `spec` as a shell does, with an empty stdin. */
async function notes(directory: string, spec: OpenAPIObject, args: string[]) {
  const specPath = join(directory, 'openapi.json');
  const cliPath = join(directory, 'notes.mjs');
  await writeFile(specPath, JSON.stringify(spec));
  await writeFile(
    cliPath,
    `import { command } from '@sdk-it/command';
const [spec, ...args] = process.argv.slice(2);
const program = await command(spec, { name: 'notes' });
await program.parseAsync(['node', 'notes', ...args]);
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

test('an operation that accepts JSON, a form and text gets a command for each, the preferred one under its own name', async () => {
  await using workspace = await workspaceDirectory('request-variants-');
  await using api = await upstream();
  const spec = { ...notesSpec, servers: [{ url: api.url }] };

  for (const args of [
    ['createNote', '--title', 'json'],
    ['createNoteUrlencoded', '--title', 'form'],
    ['createNoteText', '--$body', 'plain'],
  ]) {
    const result = await notes(workspace.path, spec, args);
    assert.equal(result.exitCode, 0, result.stderr);
  }

  assert.deepEqual(
    api.requests.map(({ method, url, contentType }) => [
      method,
      url,
      contentType,
    ]),
    [
      ['POST', `${api.url}/notes`, 'application/json'],
      ['POST', `${api.url}/notes`, 'application/x-www-form-urlencoded'],
      ['POST', `${api.url}/notes`, 'text/plain'],
    ],
  );
  assert.equal(api.requests[0].body, '{"title":"json"}');
  assert.equal(api.requests[1].body, 'title=form');
  assert.equal(api.requests[2].body, 'plain');
});

test('the schema command describes each input of an operation with the media type it sends', async () => {
  await using workspace = await workspaceDirectory('request-variants-');

  const result = await notes(
    workspace.path,
    { ...notesSpec, servers: [{ url: 'https://api.test' }] },
    ['schema'],
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const described: Record<
    string,
    { method: string; path: string; contentType: string }
  > = JSON.parse(result.stdout);
  assert.deepEqual(
    Object.entries(described).map(([name, { method, path, contentType }]) => [
      name,
      method,
      path,
      contentType,
    ]),
    [
      ['createNote', 'POST', '/notes', 'application/json'],
      [
        'createNoteUrlencoded',
        'POST',
        '/notes',
        'application/x-www-form-urlencoded',
      ],
      ['createNoteText', 'POST', '/notes', 'text/plain'],
    ],
  );
});
