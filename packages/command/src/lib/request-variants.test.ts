import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { command } from '@sdk-it/command';
import { ttyStdin } from '@sdk-it/testing';

const note: SchemaObject = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
};

const notesSpec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Notes', version: '1.0.0' },
  servers: [{ url: 'https://api.test' }],
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

test('an operation that accepts JSON, a form and text gets a command for each, the preferred one under its own name', async (t) => {
  using _tty = ttyStdin();
  const sent: Request[] = [];
  const fetch = async (request: Request) => {
    sent.push(request);
    return new Response(null, { status: 204 });
  };
  const stdout = t.mock.method(process.stdout, 'write', () => true);
  try {
    for (const args of [
      ['createNote', '--title', 'json'],
      ['createNoteUrlencoded', '--title', 'form'],
      ['createNoteText', '--$body', 'plain'],
    ]) {
      const program = await command(notesSpec, { name: 'notes', fetch });
      program.exitOverride();
      await program.parseAsync(['node', 'notes', ...args]);
    }
  } finally {
    stdout.mock.restore();
  }

  assert.deepEqual(
    sent.map((request) => [
      request.method,
      request.url,
      request.headers.get('content-type'),
    ]),
    [
      ['POST', 'https://api.test/notes', 'application/json'],
      ['POST', 'https://api.test/notes', 'application/x-www-form-urlencoded'],
      ['POST', 'https://api.test/notes', 'text/plain'],
    ],
  );
  assert.equal(await sent[0].text(), '{"title":"json"}');
  assert.equal(await sent[1].text(), 'title=form');
  assert.equal(await sent[2].text(), 'plain');
});

test('the schema command describes each input of an operation with the media type it sends', async (t) => {
  using _tty = ttyStdin();
  const program = await command(notesSpec, {
    name: 'notes',
    fetch: async () => new Response(null, { status: 204 }),
  });
  program.exitOverride();
  const stdout = t.mock.method(process.stdout, 'write', () => true);
  try {
    await program.parseAsync(['node', 'notes', 'schema']);
  } finally {
    stdout.mock.restore();
  }

  const described: Record<
    string,
    { method: string; path: string; contentType: string }
  > = JSON.parse(
    stdout.mock.calls.map((call) => String(call.arguments[0])).join(''),
  );
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
