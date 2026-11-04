import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const note: SchemaObject = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
};

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

/**
 * Generates the SDK into `directory`, type-checks it with `consumer` as
 * src/consumer.ts, and loads its bundle (and its agent tools, when asked for).
 */
async function generateClient(
  directory: string,
  spec: OpenAPIObject,
  consumer: string,
  agentTools?: 'ai-sdk' | 'openai-agents',
) {
  await generate(spec, {
    output: directory,
    name: 'Notes',
    readme: false,
    mode: 'full',
    agentTools,
  });
  await writeFile(
    join(directory, 'src/consumer.ts'),
    `import { Notes } from './index.ts';\nconst client = new Notes({ baseUrl: 'https://api.test' });\n${consumer}\n`,
  );
  const { files, diagnostics } = typecheck(join(directory, 'tsconfig.json'));
  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  // The generated index re-exports the agent tools, whose libraries load
  // CommonJS dependencies, so the bundle leaves npm packages to Node, as the
  // user's app does.
  const bundle = join(directory, 'client.mjs');
  await build({
    entryPoints: [join(directory, 'src/index.ts')],
    outfile: bundle,
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const sdk = await import(pathToFileURL(bundle).href);
  const { Notes } = sdk;
  const sent: Request[] = [];
  const client = new Notes({
    baseUrl: 'https://api.test',
    fetch: async (request: Request) => {
      sent.push(request);
      return new Response(null, { status: 204 });
    },
  });
  return { diagnostics, client, sent, sdk };
}

/** Captures what `run` prints through console, stdout or stderr, restoring each once it settles. */
async function printedBy(t: TestContext, run: () => Promise<void>) {
  const spies = [
    ...(
      [
        'log',
        'info',
        'warn',
        'error',
        'debug',
        'dir',
        'table',
        'trace',
      ] as const
    ).map((method) => t.mock.method(console, method, () => undefined)),
    t.mock.method(process.stdout, 'write', () => true),
    t.mock.method(process.stderr, 'write', () => true),
  ];
  try {
    await run();
  } finally {
    for (const spy of spies) spy.mock.restore();
  }
  return spies.flatMap((spy) => spy.mock.calls.map((call) => call.arguments));
}

/** What each request a JSON tool call sent carried: its media type and body. */
async function sentBodies(sent: Request[]) {
  return Promise.all(
    sent.map(async (request) => [
      request.method,
      request.url,
      request.headers.get('content-type'),
      await request.text(),
    ]),
  );
}

const toolCalls = [
  ['POST', 'https://api.test/notes', 'application/json', '{"title":"json"}'],
  [
    'POST',
    'https://api.test/notes',
    'application/x-www-form-urlencoded',
    'title=form',
  ],
  ['POST', 'https://api.test/notes', 'text/plain', 'plain'],
];

const binary: SchemaObject = { type: 'string', format: 'binary' };

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
    accepted: `{ $body: '<note>hi</note>' }`,
    rejected: `{ $body: 1 }`,
    input: () => ({ $body: '<note>hi</note>' }),
    body: '<note>hi</note>',
  })),
  ...(['application/vnd.api+json', 'text/json'] as const).map((media) => ({
    media,
    schema: note,
    accepted: `{ title: 'Groceries' }`,
    rejected: `{ title: 1 }`,
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
    accepted: `{ $body: new Blob(['bytes']) }`,
    rejected: `{ $body: 'bytes' }`,
    input: () => ({ $body: new Blob(['bytes']) }),
    body: 'bytes',
  })),
];

void test.each(
  singleBodies,
  ({ media, schema, accepted, rejected, input, body }) =>
    test(`a ${media} request body reaches the server unchanged with its media type`, async () => {
      await using workspace = await workspaceDirectory('request-encoding-');
      try {
        const { diagnostics, client, sent } = await generateClient(
          workspace.path,
          notesSpec({ [media]: schema ? { schema } : {} }),
          `void client.request('POST /notes', ${accepted});\n// @ts-expect-error the body has the wrong type for ${media}.\nvoid client.request('POST /notes', ${rejected});`,
        );

        await client.request('POST /notes', input());

        assert.deepEqual(diagnostics, []);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].method, 'POST');
        assert.equal(sent[0].url, 'https://api.test/notes');
        assert.equal(sent[0].headers.get('content-type'), media);
        assert.equal(await sent[0].text(), body);
      } finally {
        await stop();
      }
    }),
);

test('a binary body beside a path parameter fills the URL and sends the Blob', async () => {
  await using workspace = await workspaceDirectory('request-binary-path-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      {
        openapi: '3.1.0',
        info: { title: 'Files', version: '1.0.0' },
        servers: [{ url: 'https://api.test' }],
        paths: {
          '/files/{id}': {
            put: {
              operationId: 'putFile',
              tags: ['files'],
              parameters: [
                {
                  name: 'id',
                  in: 'path',
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              requestBody: {
                required: true,
                content: { 'application/octet-stream': { schema: binary } },
              },
              responses: { '204': { description: 'Stored' } },
            },
          },
        },
      },
      `void client.request('PUT /files/{id}', { id: 'f1', $body: new Blob(['bytes']) });
// @ts-expect-error the path parameter is required beside the body.
void client.request('PUT /files/{id}', { $body: new Blob(['bytes']) });`,
    );

    await client.request('PUT /files/{id}', {
      id: 'f1',
      $body: new Blob(['bytes']),
    });

    assert.deepEqual(diagnostics, []);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'PUT');
    assert.equal(sent[0].url, 'https://api.test/files/f1');
    assert.equal(
      sent[0].headers.get('content-type'),
      'application/octet-stream',
    );
    assert.equal(await sent[0].text(), 'bytes');
  } finally {
    await stop();
  }
});

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

test('an operation that accepts several encodings sends each through its own key, the preferred one unprefixed', async () => {
  await using workspace = await workspaceDirectory('request-variants-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      notesSpec(everyEncoding),
      '',
    );

    await client.request('POST /notes', { title: 'json' });
    await client.request('urlencoded POST /notes', { title: 'form' });
    await client.request('formdata POST /notes', {
      title: 'upload',
      file: new Blob(['bytes']),
    });
    await client.request('text POST /notes', { $body: 'plain' });
    await client.request('binary POST /notes', {
      $body: new Blob(['raw']),
    });

    assert.deepEqual(diagnostics, []);
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
  } finally {
    await stop();
  }
});

test('an operation with several encodings has exactly one key per encoding, each typed by its own input', async () => {
  await using workspace = await workspaceDirectory('request-variant-types-');
  try {
    const { diagnostics } = await generateClient(
      workspace.path,
      notesSpec(everyEncoding),
      `type Endpoint = Parameters<typeof client.request>[0];
const keys: Record<Endpoint, true> = {
  'POST /notes': true,
  'urlencoded POST /notes': true,
  'formdata POST /notes': true,
  'text POST /notes': true,
  'binary POST /notes': true,
};
void keys;
void client.request('formdata POST /notes', { file: new Blob(['bytes']) });
// @ts-expect-error the multipart input requires its file.
void client.request('formdata POST /notes', { title: 'upload' });
void client.request('text POST /notes', { $body: 'plain' });
// @ts-expect-error a text body is a string.
void client.request('text POST /notes', { $body: new Blob(['raw']) });`,
    );

    assert.deepEqual(diagnostics, []);
  } finally {
    await stop();
  }
});

test('the generated AI SDK tools give every input a JSON tool call can send its own tool, each validating and sending its own input without printing it', async (t) => {
  await using workspace = await workspaceDirectory('request-variant-tools-');
  try {
    const { diagnostics, client, sent, sdk } = await generateClient(
      workspace.path,
      notesSpec(everyEncoding),
      '',
      'ai-sdk',
    );
    const { tools } = sdk.notes;
    const context = { context: { client } };

    const printed = await printedBy(t, async () => {
      await tools.createNote.execute({ title: 'json' }, context);
      await tools.createNoteUrlencoded.execute({ title: 'form' }, context);
      await tools.createNoteText.execute({ $body: 'plain' }, context);
    });

    assert.deepEqual(printed, []);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(Object.keys(tools), [
      'createNote',
      'createNoteUrlencoded',
      'createNoteText',
    ]);
    assert.equal(
      tools.createNoteText.inputSchema.safeParse({ $body: 'x' }).success,
      true,
    );
    assert.equal(
      tools.createNote.inputSchema.safeParse({ $body: 'x' }).success,
      false,
    );
    assert.deepEqual(await sentBodies(sent), toolCalls);
  } finally {
    await stop();
  }
});

test('the generated OpenAI Agents tools load, with a tool for every input a JSON tool call can send, each parsing and sending its own input without printing it', async (t) => {
  await using workspace = await workspaceDirectory('request-variant-agents-');
  try {
    const { diagnostics, client, sent, sdk } = await generateClient(
      workspace.path,
      notesSpec(everyEncoding),
      '',
      'openai-agents',
    );
    const tools: {
      name: string;
      invoke: (context: unknown, input: string) => Promise<unknown>;
    }[] = sdk.notes;
    const context = { context: { client } };

    const printed = await printedBy(t, async () => {
      for (const [name, input] of [
        ['createNote', { title: 'json' }],
        ['createNoteUrlencoded', { title: 'form' }],
        ['createNoteText', { $body: 'plain' }],
      ] as const) {
        await tools
          .find((tool) => tool.name === name)
          ?.invoke(context, JSON.stringify(input));
      }
    });

    assert.deepEqual(printed, []);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['createNote', 'createNoteUrlencoded', 'createNoteText'],
    );
    assert.deepEqual(await sentBodies(sent), toolCalls);
  } finally {
    await stop();
  }
});

test('the README snippet shows the body the client sends, not the first media type the spec lists', async () => {
  await using workspace = await workspaceDirectory('request-snippet-');
  await generate(
    notesSpec({
      'application/xml': {
        schema: {
          type: 'object',
          properties: { xmlOnly: { type: 'string' } },
          required: ['xmlOnly'],
        },
      },
      'application/json': { schema: note },
    }),
    { output: workspace.path, name: 'Notes', readme: true },
  );

  const readme = await readFile(join(workspace.path, 'README.md'), 'utf8');

  const snippets = readme.match(/request\('POST \/notes', \{[^}]*\}/g) ?? [];
  assert.ok(snippets.length > 0);
  for (const snippet of snippets) {
    assert.match(snippet, /title/);
    assert.doesNotMatch(snippet, /xmlOnly/);
  }
});

const attachments: SchemaObject = {
  type: 'object',
  properties: {
    files: { type: 'array', items: binary },
    tags: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
  required: ['files'],
};

test('a multipart array of files reaches the server as one part per file', async () => {
  await using workspace = await workspaceDirectory('request-multipart-files-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      notesSpec({ 'multipart/form-data': { schema: attachments } }),
      `void client.request('POST /notes', { files: [new Blob(['a'])] });
// @ts-expect-error files is a list of Blobs, not one Blob.
void client.request('POST /notes', { files: new Blob(['a']) });`,
    );

    await client.request('POST /notes', {
      files: [new Blob(['a']), new Blob(['b'])],
    });

    assert.deepEqual(diagnostics, []);
    const files = (await sent[0].formData()).getAll('files');
    assert.deepEqual(
      await Promise.all(
        files.map((file) => (typeof file === 'string' ? file : file.text())),
      ),
      ['a', 'b'],
    );
  } finally {
    await stop();
  }
});

test('a multipart array of strings reaches the server as one part per string', async () => {
  await using workspace = await workspaceDirectory('request-multipart-tags-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      notesSpec({ 'multipart/form-data': { schema: attachments } }),
      `void client.request('POST /notes', { files: [], tags: ['x'] });`,
    );

    await client.request('POST /notes', { files: [], tags: ['x', 'y'] });

    assert.deepEqual(diagnostics, []);
    assert.deepEqual((await sent[0].formData()).getAll('tags'), ['x', 'y']);
  } finally {
    await stop();
  }
});

test('a multipart field the caller leaves out sends no part', async () => {
  await using workspace = await workspaceDirectory('request-multipart-absent-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      notesSpec({ 'multipart/form-data': { schema: attachments } }),
      `void client.request('POST /notes', { files: [] });`,
    );

    await client.request('POST /notes', { files: [new Blob(['a'])] });

    assert.deepEqual(diagnostics, []);
    const form = await sent[0].formData();
    assert.deepEqual([...form.keys()], ['files']);
  } finally {
    await stop();
  }
});

test('an empty multipart array sends no part', async () => {
  await using workspace = await workspaceDirectory('request-multipart-empty-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      notesSpec({ 'multipart/form-data': { schema: attachments } }),
      `void client.request('POST /notes', { files: [], tags: [] });`,
    );

    await client.request('POST /notes', {
      files: [new Blob(['a'])],
      tags: [],
    });

    assert.deepEqual(diagnostics, []);
    const form = await sent[0].formData();
    assert.deepEqual([...form.keys()], ['files']);
  } finally {
    await stop();
  }
});

const form: SchemaObject = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    note: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title'],
};

test('a urlencoded field the caller leaves out sends no entry', async () => {
  await using workspace = await workspaceDirectory(
    'request-urlencoded-absent-',
  );
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      notesSpec({ 'application/x-www-form-urlencoded': { schema: form } }),
      `void client.request('POST /notes', { title: 't' });`,
    );

    await client.request('POST /notes', { title: 't' });

    assert.deepEqual(diagnostics, []);
    assert.equal(await sent[0].text(), 'title=t');
  } finally {
    await stop();
  }
});

test('a urlencoded array sends one entry per item under its key', async () => {
  await using workspace = await workspaceDirectory('request-urlencoded-array-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      notesSpec({ 'application/x-www-form-urlencoded': { schema: form } }),
      `void client.request('POST /notes', { title: 't', tags: ['x'] });`,
    );

    await client.request('POST /notes', { title: 't', tags: ['x', 'y'] });

    assert.deepEqual(diagnostics, []);
    assert.deepEqual(new URLSearchParams(await sent[0].text()).getAll('tags'), [
      'x',
      'y',
    ]);
  } finally {
    await stop();
  }
});

test('a query array sends one entry per item under its key', async () => {
  await using workspace = await workspaceDirectory('request-query-array-');
  try {
    const { diagnostics, client, sent } = await generateClient(
      workspace.path,
      {
        openapi: '3.1.0',
        info: { title: 'Notes', version: '1.0.0' },
        servers: [{ url: 'https://api.test' }],
        paths: {
          '/notes': {
            get: {
              operationId: 'listNotes',
              tags: ['notes'],
              parameters: [
                {
                  name: 'tags',
                  in: 'query',
                  schema: { type: 'array', items: { type: 'string' } },
                },
              ],
              responses: { '204': { description: 'Listed' } },
            },
          },
        },
      },
      `void client.request('GET /notes', { tags: ['x'] });`,
    );

    await client.request('GET /notes', { tags: ['x', 'y'] });

    assert.deepEqual(diagnostics, []);
    assert.equal(new URL(sent[0].url).search, '?tags=x&tags=y');
  } finally {
    await stop();
  }
});
