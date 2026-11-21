import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/node';

import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { renderModule } from '@sdk-it/typescript';

const tscBin = join(
  dirname(
    fileURLToPath(import.meta.resolve('@typescript/native/package.json')),
  ),
  'bin/tsc',
);

function documentWith(schemas: Record<string, SchemaObject>): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    components: { schemas },
  };
}

/** The TypeScript 7.1 language server's hover text at `position` of `consumer.ts` in `directory`. */
async function hoverText(
  directory: string,
  consumer: string,
  position: { line: number; character: number },
) {
  const server = spawn(process.execPath, [tscBin, '--lsp', '--stdio'], {
    cwd: directory,
  });
  const connection = createMessageConnection(
    new StreamMessageReader(server.stdout),
    new StreamMessageWriter(server.stdin),
  );
  try {
    connection.onRequest('workspace/configuration', (params: { items: [] }) =>
      params.items.map(() => null),
    );
    connection.listen();
    const root = pathToFileURL(directory).href;
    await connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: root,
      workspaceFolders: [{ uri: root, name: 'annotations' }],
      capabilities: {
        textDocument: { hover: { contentFormat: ['markdown'] } },
      },
    });
    await connection.sendNotification('initialized', {});
    const uri = pathToFileURL(join(directory, 'consumer.ts')).href;
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'typescript',
        version: 1,
        text: consumer,
      },
    });
    const hover = await connection.sendRequest<{
      contents: { value: string };
    } | null>('textDocument/hover', { textDocument: { uri }, position });
    return hover?.contents.value ?? '';
  } finally {
    connection.dispose();
    server.kill();
    await once(server, 'close');
  }
}

test('a "*/" inside a model or property description keeps the generated code valid', async () => {
  const { text } = await renderModule(
    documentWith({
      Row: {
        type: 'object',
        description: 'Matches /* globs */ such as a/*/b',
        properties: {
          path: { type: 'string', description: 'A glob like src/**/*.ts */' },
        },
        required: ['path'],
      },
    }),
    { name: 'Client' },
  );
  await using workspace = await analysisWorkspace('property-annotations-', {
    'sdk.ts': text,
    'consumer.ts': `import type { Row } from './sdk.ts';
export const row: Row = { path: 'src' };
`,
  });

  const { diagnostics } = typecheck(workspace.tsconfig);

  assert.deepStrictEqual(
    diagnostics.map(({ file, message }) => ({ file, message })),
    [],
  );
});

test('a readOnly response property is readonly and a writeOnly required one is optional', async () => {
  const { text } = await renderModule(
    documentWith({
      Account: {
        type: 'object',
        properties: {
          id: { type: 'string', readOnly: true },
          password: { type: 'string', writeOnly: true },
          name: { type: 'string' },
        },
        required: ['id', 'password', 'name'],
      },
    }),
    { name: 'Client' },
  );
  await using workspace = await analysisWorkspace('property-annotations-', {
    'sdk.ts': text,
    'consumer.ts': `import type { Account } from './sdk.ts';
export const account: Account = { id: 'a1', name: 'Ada' };
account.id = 'a2';
account.name = 'Grace';
// @ts-expect-error name stays required
export const nameless: Account = { id: 'a1' };
`,
  });
  const consumer = join(workspace.path, 'consumer.ts');

  const errors = typecheck(workspace.tsconfig)
    .diagnostics.filter((diagnostic) => diagnostic.file === consumer)
    .map(({ line, message }) => ({ line, message }));

  assert.deepStrictEqual(errors, [
    {
      line: 3,
      message: "Cannot assign to 'id' because it is a read-only property.",
    },
  ]);
});

test('hovering a response property shows its title, description, deprecation, default and examples, inline and beside a $ref', async () => {
  const { text } = await renderModule(
    documentWith({
      Status: {
        type: 'string',
        enum: ['active', 'closed'],
        description: 'The status of any record.',
      },
      Order: {
        type: 'object',
        properties: {
          note: {
            type: ['string', 'null'],
            title: 'Note',
            description: 'A note for the courier.',
            deprecated: true,
            default: null,
            examples: ['Leave at the door'],
          },
          status: {
            $ref: '#/components/schemas/Status',
            title: 'Order status',
            deprecated: true,
            description: 'Where the order is.',
            default: 'active',
          },
        },
        required: ['note', 'status'],
      },
    }),
    { name: 'Client' },
  );
  const consumer = `import type { Order } from './sdk.ts';
declare const order: Order;
order.note;
order.status;
`;
  await using workspace = await analysisWorkspace('property-annotations-', {
    'sdk.ts': text,
    'consumer.ts': consumer,
  });

  const note = await hoverText(workspace.path, consumer, {
    line: 2,
    character: 7,
  });
  const status = await hoverText(workspace.path, consumer, {
    line: 3,
    character: 7,
  });

  assert.match(note, /Note\s+A note for the courier\./);
  assert.match(note, /@deprecated/);
  assert.match(note, /@default.*null/);
  assert.match(note, /@example[\s\S]*"Leave at the door"/);
  assert.match(status, /Order status\s+Where the order is\./);
  assert.match(status, /@deprecated/);
  assert.doesNotMatch(status, /The status of any record\./);
  assert.match(status, /@default.*"active"/);
});
