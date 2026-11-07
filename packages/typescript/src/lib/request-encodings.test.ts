import { HttpServer } from '@zukhruf/testing/http';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { runNode, typecheck, workspaceDirectory } from '@sdk-it/testing';
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
 * src/consumer.ts, and imports it (and its agent tools, when asked for).
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
    `import { createNotes } from './index.ts';\nconst client = createNotes({ baseUrl: 'https://api.test' });\n${consumer}\n`,
  );
  const { files, diagnostics } = typecheck(join(directory, 'tsconfig.json'));
  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  const sdk = await import(pathToFileURL(join(directory, 'src/index.ts')).href);
  const agents = agentTools
    ? await import(pathToFileURL(join(directory, 'src/agents.ts')).href)
    : undefined;
  const { createNotes } = sdk;
  const sent: Request[] = [];
  const client = createNotes({
    baseUrl: 'https://api.test',
    fetch: async (request: Request) => {
      sent.push(request);
      return new Response(null, { status: 204 });
    },
  });
  return { diagnostics, client, sent, sdk, agents };
}

/** The API the agent tools call: it records each request and answers 204. */
async function upstream() {
  const requests: (string | undefined)[][] = [];
  const server = await new HttpServer().start(async (request, response) => {
    requests.push([
      request.method,
      new URL(request.url ?? '', `http://${request.headers.host}`).href,
      request.headers['content-type'],
      await text(request),
    ]);
    response.writeHead(204);
    response.end();
  });
  return {
    url: server.origin,
    requests,
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/**
 * Runs `script` as a module in `directory` (beside the generated SDK) in its own
 * Node process, with `baseUrl` as its first argument, and returns what it
 * printed.
 */
async function runScript(directory: string, script: string, baseUrl: string) {
  const path = join(directory, 'tools.mjs');
  await writeFile(path, script);
  return runNode([path, baseUrl]);
}

/** The requests the three JSON tool calls send to the API at `origin`. */
function toolCalls(origin: string) {
  return [
    ['POST', `${origin}/notes`, 'application/json', '{"title":"json"}'],
    [
      'POST',
      `${origin}/notes`,
      'application/x-www-form-urlencoded',
      'title=form',
    ],
    ['POST', `${origin}/notes`, 'text/plain', 'plain'],
  ];
}

const binary: SchemaObject = { type: 'string', format: 'binary' };

const singleBodies = [
  ...(
    [
      ['text/plain', { type: 'string' }],
      ['text/csv', { type: 'string' }],
      ['text/json', note],
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
  ...(['application/vnd.api+json'] as const).map((media) => ({
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
    }),
);

test('a binary body beside a path parameter fills the URL and sends the Blob', async () => {
  await using workspace = await workspaceDirectory('request-binary-path-');
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
  assert.equal(sent[0].headers.get('content-type'), 'application/octet-stream');
  assert.equal(await sent[0].text(), 'bytes');
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
});

test('an operation with several encodings has exactly one key per encoding, each typed by its own input', async () => {
  await using workspace = await workspaceDirectory('request-variant-types-');
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
});

test('the generated AI SDK tools give every input a JSON tool call can send its own tool, each validating and sending its own input without printing it', async () => {
  await using workspace = await workspaceDirectory('request-variant-tools-');
  await using api = await upstream();
  const { diagnostics, agents } = await generateClient(
    workspace.path,
    notesSpec(everyEncoding),
    '',
    'ai-sdk',
  );
  const { tools } = agents.notes;

  const printed = await runScript(
    workspace.path,
    `import { createNotes } from './src/index.ts';
import { notes } from './src/agents.ts';
const context = { context: { client: createNotes({ baseUrl: process.argv[2] }) } };
await notes.tools.createNote.execute({ title: 'json' }, context);
await notes.tools.createNoteUrlencoded.execute({ title: 'form' }, context);
await notes.tools.createNoteText.execute({ $body: 'plain' }, context);
`,
    api.url,
  );

  assert.deepEqual(printed, { exitCode: 0, stdout: '', stderr: '' });
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
  assert.deepEqual(api.requests, toolCalls(api.url));
});

test('the generated OpenAI Agents tools load, with a tool for every input a JSON tool call can send, each parsing and sending its own input without printing it', async () => {
  await using workspace = await workspaceDirectory('request-variant-agents-');
  await using api = await upstream();
  const { diagnostics, agents } = await generateClient(
    workspace.path,
    notesSpec(everyEncoding),
    '',
    'openai-agents',
  );
  const tools: { name: string }[] = agents.notes;

  const printed = await runScript(
    workspace.path,
    `import { createNotes } from './src/index.ts';
import { notes } from './src/agents.ts';
const context = { context: { client: createNotes({ baseUrl: process.argv[2] }) } };
for (const [name, input] of [
  ['createNote', { title: 'json' }],
  ['createNoteUrlencoded', { title: 'form' }],
  ['createNoteText', { $body: 'plain' }],
]) {
  await notes.find((tool) => tool.name === name).invoke(context, JSON.stringify(input));
}
`,
    api.url,
  );

  assert.deepEqual(printed, { exitCode: 0, stdout: '', stderr: '' });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['createNote', 'createNoteUrlencoded', 'createNoteText'],
  );
  assert.deepEqual(api.requests, toolCalls(api.url));
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
});

test('a multipart array of strings reaches the server as one part per string', async () => {
  await using workspace = await workspaceDirectory('request-multipart-tags-');
  const { diagnostics, client, sent } = await generateClient(
    workspace.path,
    notesSpec({ 'multipart/form-data': { schema: attachments } }),
    `void client.request('POST /notes', { files: [], tags: ['x'] });`,
  );

  await client.request('POST /notes', { files: [], tags: ['x', 'y'] });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual((await sent[0].formData()).getAll('tags'), ['x', 'y']);
});

test('a multipart field the caller leaves out sends no part', async () => {
  await using workspace = await workspaceDirectory('request-multipart-absent-');
  const { diagnostics, client, sent } = await generateClient(
    workspace.path,
    notesSpec({ 'multipart/form-data': { schema: attachments } }),
    `void client.request('POST /notes', { files: [] });`,
  );

  await client.request('POST /notes', { files: [new Blob(['a'])] });

  assert.deepEqual(diagnostics, []);
  const form = await sent[0].formData();
  assert.deepEqual([...form.keys()], ['files']);
});

test('an empty multipart array sends no part', async () => {
  await using workspace = await workspaceDirectory('request-multipart-empty-');
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
  const { diagnostics, client, sent } = await generateClient(
    workspace.path,
    notesSpec({ 'application/x-www-form-urlencoded': { schema: form } }),
    `void client.request('POST /notes', { title: 't' });`,
  );

  await client.request('POST /notes', { title: 't' });

  assert.deepEqual(diagnostics, []);
  assert.equal(await sent[0].text(), 'title=t');
});

test('a urlencoded array sends one entry per item under its key', async () => {
  await using workspace = await workspaceDirectory('request-urlencoded-array-');
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
});

test('a query array sends one entry per item under its key', async () => {
  await using workspace = await workspaceDirectory('request-query-array-');
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
});

test('a generated OpenAI Agents tool sends a call whose optional fields the model leaves null without those fields, and advertises them as required and nullable', async () => {
  await using workspace = await workspaceDirectory('request-agents-null-');
  const { diagnostics, client, sent, agents } = await generateClient(
    workspace.path,
    notesSpec({ 'application/json': { schema: form } }),
    '',
    'openai-agents',
  );
  const [createNote]: {
    parameters: { required: string[]; properties: Record<string, unknown> };
    invoke: (context: unknown, input: string) => Promise<unknown>;
  }[] = agents.notes;

  await createNote.invoke(
    { context: { client } },
    JSON.stringify({ title: 't', note: null, tags: null }),
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(await Promise.all(sent.map((request) => request.text())), [
    '{"title":"t"}',
  ]);
  assert.deepEqual(createNote.parameters.required.toSorted(), [
    'note',
    'tags',
    'title',
  ]);
  assert.deepEqual(createNote.parameters.properties.note, {
    anyOf: [{ type: 'string' }, { type: 'null' }],
  });
});

function accountsSpec(): OpenAPIObject {
  const listed = { '204': { description: 'Done' } };
  return {
    openapi: '3.1.0',
    info: { title: 'Accounts', version: '1.0.0' },
    servers: [{ url: 'https://api.test' }],
    tags: [
      { name: 'User Profiles', description: 'Profiles of users' },
      { name: '2fa', description: 'Two factor' },
      { name: 'billing', description: 'Invoices' },
    ],
    paths: {
      '/profiles': {
        get: {
          operationId: 'listProfiles',
          tags: ['User Profiles'],
          responses: listed,
        },
      },
      '/2fa': {
        post: {
          operationId: 'enableTwoFactor',
          tags: ['2fa'],
          responses: listed,
        },
      },
      '/invoices': {
        get: {
          operationId: 'listInvoices',
          tags: ['billing'],
          responses: listed,
        },
      },
      '/health': { get: { operationId: 'checkHealth', responses: listed } },
    },
  };
}

test('the generated AI SDK tools keep every group: a spaced, a digit-leading and an untagged one', async () => {
  await using workspace = await workspaceDirectory('request-tool-groups-');
  const { diagnostics, agents } = await generateClient(
    workspace.path,
    accountsSpec(),
    '',
    'ai-sdk',
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(Object.keys(agents.userProfiles.tools), ['listProfiles']);
  assert.deepEqual(Object.keys(agents._2fa.tools), ['enableTwoFactor']);
  assert.deepEqual(Object.keys(agents.billing.tools), ['listInvoices']);
  const everyTool = Object.values(agents).flatMap((value) =>
    value && typeof value === 'object' && 'tools' in value
      ? Object.keys(Object(value.tools))
      : [],
  );
  assert.ok(everyTool.includes('checkHealth'));
});

test('the generated OpenAI Agents tools compile and keep every group under the identifiers userProfiles, _2fa and billing', async () => {
  await using workspace = await workspaceDirectory('request-agent-groups-');
  const { diagnostics, agents } = await generateClient(
    workspace.path,
    accountsSpec(),
    '',
    'openai-agents',
  );
  const names = (group: unknown) =>
    Array.isArray(group) ? group.map((tool) => tool.name) : [];

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(names(agents.userProfiles), ['listProfiles']);
  assert.deepEqual(names(agents._2fa), ['enableTwoFactor']);
  assert.deepEqual(names(agents.billing), ['listInvoices']);
  assert.ok(Object.values(agents).flatMap(names).includes('checkHealth'));
});

test("the generated AI SDK groups are ToolLoopAgent settings: an id from the tag's summary or name, instructions from its description", async () => {
  await using workspace = await workspaceDirectory('request-agent-settings-');
  const { diagnostics, agents } = await generateClient(
    workspace.path,
    accountsSpec(),
    `import { ToolLoopAgent } from 'ai';
import { billing } from './agents.ts';
void new ToolLoopAgent({ model: 'openai/gpt-5', ...billing });`,
    'ai-sdk',
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(Object.keys(agents.userProfiles).sort(), [
    'id',
    'instructions',
    'tools',
  ]);
  assert.equal(agents.userProfiles.id, 'User Profiles');
  assert.equal(agents.userProfiles.instructions, 'Profiles of users');
  assert.equal(agents.billing.id, 'billing');
  assert.equal(agents.billing.instructions, 'Invoices');
  const health = Object.values(agents).find(
    (value) =>
      value &&
      typeof value === 'object' &&
      'tools' in value &&
      Object.keys(Object(value.tools)).includes('checkHealth'),
  );
  assert.deepEqual(Object.keys(Object(health)).sort(), ['id', 'tools']);
});

test("a generated AI SDK group takes the tag's authored x-name and x-instructions first, and its description round-trips with backticks, ${} and newlines", async () => {
  await using workspace = await workspaceDirectory('request-agent-precedence-');
  const { diagnostics, agents } = await generateClient(
    workspace.path,
    {
      openapi: '3.2.0',
      info: { title: 'Agents', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      tags: [
        {
          name: 'billing',
          summary: 'Billing',
          description: 'Invoices',
          'x-name': "Billing 'Agent'",
          'x-instructions': 'Handle invoices',
        },
        {
          name: 'notes',
          summary: 'Notes',
          description: 'Use `notes` and ${x}\nthen stop',
        },
        { name: 'plain' },
      ],
      paths: {
        '/invoices': {
          get: {
            operationId: 'listInvoices',
            tags: ['billing'],
            responses: { '204': { description: 'Done' } },
          },
        },
        '/notes': {
          get: {
            operationId: 'listNotes',
            tags: ['notes'],
            responses: { '204': { description: 'Done' } },
          },
        },
        '/plain': {
          get: {
            operationId: 'getPlain',
            tags: ['plain'],
            responses: { '204': { description: 'Done' } },
          },
        },
      },
    },
    '',
    'ai-sdk',
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(agents.billing.id, "Billing 'Agent'");
  assert.equal(agents.billing.instructions, 'Handle invoices');
  assert.equal(agents.notes.id, 'Notes');
  assert.equal(agents.notes.instructions, 'Use `notes` and ${x}\nthen stop');
  assert.deepEqual(Object.keys(agents.plain).sort(), ['id', 'tools']);
  assert.equal(agents.plain.id, 'plain');
});
