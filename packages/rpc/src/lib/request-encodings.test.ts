import { TemporaryFiles } from '@zukhruf/testing/fs';
import { test } from '@zukhruf/testing/node';
import { type Tool, asSchema } from 'ai';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { rpc, toAgents } from '@sdk-it/rpc';

const note: SchemaObject = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
};
const binary: SchemaObject = { type: 'string', format: 'binary' };

function notesSpec(
  content: Record<string, { schema?: SchemaObject }>,
): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Notes', version: '1.0.0' },
    servers: [{ url: 'https://api.test' }],
    tags: [{ name: 'notes' }],
    paths: {
      '/notes': {
        post: {
          operationId: 'createNote',
          tags: ['notes'],
          requestBody: { required: true, content },
          responses: { '204': { description: 'Created' } },
        },
      },
    },
  };
}

/** Writes `spec` to a file in `directory` and returns its path. */
async function specFile(directory: string, spec: OpenAPIObject) {
  const path = join(directory, 'openapi.json');
  await writeFile(path, JSON.stringify(spec));
  return path;
}

function capture() {
  const sent: Request[] = [];
  return {
    sent,
    fetch: async (request: Request) => {
      sent.push(request);
      return new Response(null, { status: 204 });
    },
  };
}

const singleBodies = [
  ...(
    [
      ['text/plain', { type: 'string' }],
      ['text/csv', { type: 'string' }],
      ['application/xml', note],
      ['text/xml', note],
      ['application/atom+xml', note],
    ] as const
  ).map(([media, schema]) => ({
    media,
    schema,
    input: () => ({ $body: '<note>hi</note>' }),
    body: '<note>hi</note>',
  })),
  ...(['application/vnd.api+json', 'text/json'] as const).map((media) => ({
    media,
    schema: note,
    input: () => ({ title: 'Groceries' }),
    body: '{"title":"Groceries"}',
  })),
  ...(
    [
      ['application/octet-stream', binary],
      ['image/png', undefined],
      ['application/pdf', binary],
    ] as const
  ).map(([media, schema]) => ({
    media,
    schema,
    input: () => ({ $body: new Blob(['bytes']) }),
    body: 'bytes',
  })),
];

void test.each(singleBodies, ({ media, schema, input, body }) =>
  test(`rpc sends a ${media} request body unchanged with its media type`, async () => {
    await using directory = await new TemporaryFiles().directory(
      'rpc-request-encoding-',
    );
    const { sent, fetch } = capture();
    const client = await rpc(
      await specFile(
        directory.path,
        notesSpec({ [media]: schema ? { schema } : {} }),
      ),
      { fetch },
    );

    await client.request('POST /notes', input());

    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'POST');
    assert.equal(sent[0].url, 'https://api.test/notes');
    assert.equal(sent[0].headers.get('content-type'), media);
    assert.equal(await sent[0].text(), body);
  }),
);

const everyEncoding = {
  'multipart/form-data': {
    schema: {
      type: 'object',
      properties: { title: { type: 'string' }, file: binary },
      required: ['file'],
    },
  },
  'application/x-www-form-urlencoded': { schema: note },
  'text/plain': { schema: { type: 'string' } },
  'application/json': { schema: note },
  'application/vnd.api+json': {
    schema: { type: 'object', properties: { other: { type: 'string' } } },
  },
  'application/xml': { schema: note },
  'application/octet-stream': { schema: binary },
} satisfies Record<string, { schema: SchemaObject }>;

test('rpc sends each encoding of an operation through its own key, the preferred one unprefixed', async () => {
  await using directory = await new TemporaryFiles().directory(
    'rpc-request-variants-',
  );
  const { sent, fetch } = capture();
  const client = await rpc(
    await specFile(directory.path, notesSpec(everyEncoding)),
    { fetch },
  );

  await client.request('POST /notes', { title: 'json' });
  await client.request('urlencoded POST /notes', { title: 'form' });
  await client.request('formdata POST /notes', {
    title: 'upload',
    file: new Blob(['bytes']),
  });
  await client.request('text POST /notes', { $body: 'plain' });
  await client.request('binary POST /notes', { $body: new Blob(['raw']) });

  assert.deepEqual(Object.keys(client.schemas), [
    'POST /notes',
    'urlencoded POST /notes',
    'formdata POST /notes',
    'text POST /notes',
    'binary POST /notes',
  ]);
  assert.deepEqual(
    sent.map((request) => [
      request.method,
      request.url,
      request.headers.get('content-type')?.split(';')[0],
    ]),
    [
      ['POST', 'https://api.test/notes', 'application/json'],
      ['POST', 'https://api.test/notes', 'application/x-www-form-urlencoded'],
      ['POST', 'https://api.test/notes', 'multipart/form-data'],
      ['POST', 'https://api.test/notes', 'text/plain'],
      ['POST', 'https://api.test/notes', 'application/octet-stream'],
    ],
  );
  assert.equal(await sent[0].text(), '{"title":"json"}');
  assert.equal(await sent[1].text(), 'title=form');
  const form = await sent[2].formData();
  assert.equal(form.get('title'), 'upload');
  const file = form.get('file');
  assert.ok(file instanceof Blob);
  assert.equal(await file.text(), 'bytes');
  assert.equal(await sent[3].text(), 'plain');
  assert.equal(await sent[4].text(), 'raw');
});

test('rpc agents get a tool for every input a JSON tool call can send, each advertising and sending its own input', async () => {
  await using directory = await new TemporaryFiles().directory(
    'rpc-request-tools-',
  );
  const { sent, fetch } = capture();
  const agents = await toAgents(
    await specFile(directory.path, notesSpec(everyEncoding)),
    { baseUrl: 'https://api.test', fetch },
  );
  const tools: Record<string, Tool> = agents.notes.tools;
  const call = { toolCallId: 'call-1', messages: [], context: {} };

  await tools.createNote.execute?.({ title: 'json' }, call);
  await tools.createNoteUrlencoded.execute?.({ title: 'form' }, call);
  await tools.createNoteText.execute?.({ $body: 'plain' }, call);

  assert.deepEqual(Object.keys(tools), [
    'createNote',
    'createNoteUrlencoded',
    'createNoteText',
  ]);
  const advertised = await Promise.all(
    Object.values(tools).map(
      async (tool) => (await asSchema(tool.inputSchema).jsonSchema).properties,
    ),
  );
  assert.deepEqual(
    advertised.map((properties) => Object.keys(properties ?? {})),
    [['title'], ['title'], ['$body']],
  );
  assert.deepEqual(
    await Promise.all(
      sent.map(async (request) => [
        request.headers.get('content-type'),
        await request.text(),
      ]),
    ),
    [
      ['application/json', '{"title":"json"}'],
      ['application/x-www-form-urlencoded', 'title=form'],
      ['text/plain', 'plain'],
    ],
  );
});
