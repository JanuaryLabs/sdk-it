import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/node';

import { runNode, workspaceDirectory } from '@sdk-it/testing';

const tscBin = join(
  dirname(
    fileURLToPath(import.meta.resolve('@typescript/native/package.json')),
  ),
  'bin/tsc',
);

const tsconfig = JSON.stringify({
  compilerOptions: {
    module: 'nodenext',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  contentMappers: [
    { package: '@sdk-it/content-mapper', extensions: ['.openapi.yaml'] },
  ],
  include: ['main.ts'],
});

const storeSpec = `openapi: 3.1.0
info: { title: Store, version: 1.0.0 }
servers: [{ url: https://store.test }]
paths:
  /pets/{petId}:
    get:
      operationId: getPet
      parameters:
        - { name: petId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
components:
  schemas:
    Pet:
      type: object
      required: [id, name]
      properties:
        id: { type: string }
        name: { type: string }
`;

async function writeProject(dir: string, files: Record<string, string>) {
  await writeFile(join(dir, 'tsconfig.json'), tsconfig);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
}

function tsc(dir: string) {
  return runNode([tscBin, '-p', dir, '--runExternalCode', '--pretty', 'false']);
}

/** The TypeScript 7.1 language server over `dir`, content mappers on, with `main.ts` open. */
async function languageServer(dir: string, main: string) {
  const server = spawn(process.execPath, [tscBin, '--lsp', '--stdio'], {
    cwd: dir,
  });
  const connection = createMessageConnection(
    new StreamMessageReader(server.stdout),
    new StreamMessageWriter(server.stdin),
  );
  connection.onRequest('workspace/configuration', (params: { items: [] }) =>
    params.items.map(() => null),
  );
  connection.listen();
  const root = pathToFileURL(dir).href;
  await connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri: root,
    workspaceFolders: [{ uri: root, name: 'content-mapper' }],
    initializationOptions: { runExternalCode: true },
    capabilities: {
      textDocument: { definition: { linkSupport: false }, diagnostic: {} },
    },
  });
  await connection.sendNotification('initialized', {});
  const mainUri = pathToFileURL(join(dir, 'main.ts')).href;
  await connection.sendNotification('textDocument/didOpen', {
    textDocument: {
      uri: mainUri,
      languageId: 'typescript',
      version: 1,
      text: main,
    },
  });
  return {
    diagnostics: async () => {
      const report: { items: { code: number; range: LspRange }[] } =
        await connection.sendRequest('textDocument/diagnostic', {
          textDocument: { uri: mainUri },
        });
      return report.items.map(({ code, range }) => ({
        code,
        line: range.start.line,
      }));
    },
    definition: (position: { line: number; character: number }) =>
      connection.sendRequest<{ uri: string; range: LspRange }[]>(
        'textDocument/definition',
        { textDocument: { uri: mainUri }, position },
      ),
    async [Symbol.asyncDispose]() {
      connection.dispose();
      server.kill();
      await once(server, 'close');
    },
  };
}

test('YAML that does not parse is reported in the document at the line and column the parser gives', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  await writeProject(dir.path, {
    'store.openapi.yaml': [
      'openapi: 3.1.0',
      'info: { title: Store, version: 1.0.0',
      'paths: {}',
    ].join('\n'),
    'main.ts': "export { store } from './store.openapi.yaml';\n",
  });

  const { exitCode, stdout } = await tsc(dir.path);
  await using server = await languageServer(
    dir.path,
    "export { store } from './store.openapi.yaml';\n",
  );
  const importer = await server.diagnostics();

  assert.notEqual(exitCode, 0);
  assert.match(stdout, /store\.openapi\.yaml\(3,1\): error sdk-it1: Flow map/);
  // The YAML still parses into a document, so the import keeps its types while it is fixed.
  assert.deepEqual(importer, []);
});

test('a YAML error the parser places past the end of the text is reported inside it', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  await writeProject(dir.path, {
    'store.openapi.yaml': 'openapi: [',
    'main.ts': "export { store } from './store.openapi.yaml';\n",
  });

  const { exitCode, stdout } = await tsc(dir.path);

  assert.notEqual(exitCode, 0);
  assert.match(stdout, /store\.openapi\.yaml\(1,11\): error sdk-it1:/);
});

test('YAML that loads no document leaves the importer with no exports and the document with only the YAML error', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  const main = "export { store } from './store.openapi.yaml';\n";
  await writeProject(dir.path, {
    'store.openapi.yaml': '[\n',
    'main.ts': main,
  });

  const { exitCode, stdout } = await tsc(dir.path);
  await using server = await languageServer(dir.path, main);
  const importer = await server.diagnostics();

  assert.notEqual(exitCode, 0);
  assert.match(stdout, /store\.openapi\.yaml\(\d+,\d+\): error sdk-it1:/);
  assert.doesNotMatch(stdout, /error sdk-it[23]:/);
  assert.deepEqual(importer, [{ code: 2305, line: 0 }]);
});

test('a $ref that does not resolve is reported at the $ref value in the document', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  await writeProject(dir.path, {
    'store.openapi.yaml': storeSpec.replace(
      "{ $ref: '#/components/schemas/Pet' }",
      "{ $ref: './missing.yaml' }",
    ),
    'main.ts': "export { store } from './store.openapi.yaml';\n",
  });

  const { exitCode, stdout } = await tsc(dir.path);

  assert.notEqual(exitCode, 0);
  assert.match(
    stdout,
    /store\.openapi\.yaml\(15,31\): error sdk-it2: Could not resolve \$ref \.\/missing\.yaml/,
  );
});

test('a $ref that does not resolve inside a referenced file is reported at the start of the document', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  await writeProject(dir.path, {
    // owner.yaml holds the failing $ref at a path the document also has, so
    // only the document check keeps the diagnostic off the document's own line.
    'store.openapi.yaml': storeSpec.replace(
      '        name: { type: string }\n',
      "        name: { type: string }\n        owner: { $ref: './owner.yaml#/components/schemas/Pet/properties/owner' }\n",
    ),
    'owner.yaml': [
      'components:',
      '  schemas:',
      '    Pet:',
      '      properties:',
      "        owner: { $ref: './missing.yaml' }",
    ].join('\n'),
    'main.ts': "export { store } from './store.openapi.yaml';\n",
  });

  const { exitCode, stdout } = await tsc(dir.path);

  assert.notEqual(exitCode, 0);
  assert.match(
    stdout,
    /store\.openapi\.yaml\(1,1\): error sdk-it2: Could not resolve \$ref \.\/missing\.yaml from file:\/\/\S+\/owner\.yaml/,
  );
});

test('a document whose file name is not an identifier is reported at the start of the document', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  await writeProject(dir.path, {
    '2024.openapi.yaml': storeSpec,
    'main.ts': "export * from './2024.openapi.yaml';\n",
  });

  const { exitCode, stdout } = await tsc(dir.path);

  assert.notEqual(exitCode, 0);
  assert.match(stdout, /2024\.openapi\.yaml\(1,1\): error sdk-it3:/);
});

test('code that imports the document is typed by it: inputs and outputs follow its schemas', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  await writeProject(dir.path, {
    'store.openapi.yaml': storeSpec,
    'main.ts': `import { createStore, store } from './store.openapi.yaml';

const client = createStore({ baseUrl: 'https://store.test' });
const pet = await store.request('GET /pets/{petId}', { petId: 'p1' });
const name: string = pet.name;
// @ts-expect-error id is a string in the document
const id: number = pet.id;
// @ts-expect-error petId is a string in the document
await client.request('GET /pets/{petId}', { petId: 1 });
export { id, name };
`,
  });

  const { exitCode, stdout } = await tsc(dir.path);

  assert.equal(stdout, '');
  assert.equal(exitCode, 0);
});

test('a schema in a file the document references through $ref types the import', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  await writeProject(dir.path, {
    'store.openapi.yaml': storeSpec.replace(
      "{ $ref: '#/components/schemas/Pet' }",
      "{ $ref: './owner.yaml' }",
    ),
    'owner.yaml': [
      'type: object',
      'required: [email]',
      'properties:',
      '  email: { type: string }',
    ].join('\n'),
    'main.ts': `import { store } from './store.openapi.yaml';

const owner = await store.request('GET /pets/{petId}', { petId: 'p1' });
const email: string = owner.email;
// @ts-expect-error email is a string in owner.yaml
const count: number = owner.email;
export { count, email };
`,
  });

  const { exitCode, stdout } = await tsc(dir.path);

  assert.equal(stdout, '');
  assert.equal(exitCode, 0);
});

test('go to definition on the client, a model and an endpoint lands on where the document declares them', async () => {
  await using dir = await workspaceDirectory('content-mapper-');
  const main = `import { createStore, type Pet, store, type StoreEndpoints } from './store.openapi.yaml';

type GetPet = StoreEndpoints['GET /pets/{petId}'];
const client = createStore({ baseUrl: 'https://store.test' });
const pet: Pet = await store.request('GET /pets/{petId}', { petId: 'p1' });
export { client, pet, type GetPet };
`;
  await writeProject(dir.path, {
    'store.openapi.yaml': storeSpec,
    'main.ts': main,
  });
  await using server = await languageServer(dir.path, main);
  const lines = main.split('\n');
  const yamlLines = storeSpec.split('\n');
  const definition = async (needle: string, line: number) => {
    const character = (lines[line] ?? '').indexOf(needle) + 1;
    const result = await server.definition({ line, character });
    return result.map(({ uri, range }) => ({
      file: fileURLToPath(uri).slice(dir.path.length + 1),
      text: (yamlLines[range.start.line] ?? '').slice(
        range.start.character,
        range.end.character,
      ),
      line: range.start.line,
    }));
  };

  assert.deepEqual(await definition('createStore({', 3), [
    { file: 'store.openapi.yaml', text: 'Store', line: 1 },
  ]);
  assert.deepEqual(await definition('store.request', 4), [
    { file: 'store.openapi.yaml', text: 'Store', line: 1 },
  ]);
  assert.deepEqual(await definition('Pet =', 4), [
    { file: 'store.openapi.yaml', text: 'Pet', line: 17 },
  ]);
  assert.deepEqual(await definition("'GET /pets/{petId}']", 2), [
    { file: 'store.openapi.yaml', text: 'get', line: 5 },
  ]);
});

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}
