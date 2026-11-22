import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/node';

import { DerivedDocument } from '@sdk-it/content-mapper';
import { runNode, workspaceDirectory } from '@sdk-it/testing';

const tscBin = join(
  dirname(
    fileURLToPath(import.meta.resolve('@typescript/native/package.json')),
  ),
  'bin/tsc',
);

function route(path: string) {
  return `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi listBooks */
app.get('${path}', validate(() => ({})), (c) =>
  c.json([{ id: 'b1', title: 'Type Systems' }]),
);
`;
}

/** A backend with its openapi.ts and an app whose tsconfig derives `src/backend.openapi` from it. */
async function writeWorkspace(root: string, main: string) {
  const files: Record<string, string> = {
    'backend/tsconfig.json': JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src/**/*.ts'],
    }),
    'backend/src/app.ts': route('/books'),
    'backend/openapi.ts': `import { defineOpenApi } from '@sdk-it/openapi';

export default defineOpenApi({
  tsconfig: new URL('./tsconfig.json', import.meta.url),
  document: { openapi: '3.1.0', info: { title: 'Library', version: '1.0.0' } },
});
`,
    'web/tsconfig.json': JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      contentMappers: [
        {
          package: '@sdk-it/content-mapper',
          extensions: ['.openapi'],
          options: {
            derived: { 'src/backend.openapi': '../backend/openapi.ts' },
          },
        },
      ],
      include: ['src/main.ts', 'src/backend.openapi'],
    }),
    'web/src/main.ts': main,
    // The app commits its derived document; a reader rewrites it.
    'web/src/backend.openapi': '{}\n',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
}

function tsc(project: string) {
  return runNode([
    tscBin,
    '-p',
    project,
    '--runExternalCode',
    '--pretty',
    'false',
  ]);
}

const usesBooks = `import { createBackend } from './backend.openapi';

const backend = createBackend({ baseUrl: 'https://library.test' });
export const books = backend.request('GET /books', {});
`;

test("tsc types an import of a derived document from the backend's routes, and leaves the committed document as committed", async () => {
  await using workspace = await workspaceDirectory('derived-document-');
  await writeWorkspace(workspace.path, usesBooks);

  const result = await tsc(join(workspace.path, 'web'));

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    '{}\n',
    'A reader derives the document in memory and writes nothing: the committed bytes stay',
  );
});

test('a backend route that changes is what the next tsc run types the import by, and the committed document keeps its bytes', async () => {
  await using workspace = await workspaceDirectory('derived-document-change-');
  await writeWorkspace(workspace.path, usesBooks);
  assert.equal((await tsc(join(workspace.path, 'web'))).exitCode, 0);

  await writeFile(join(workspace.path, 'backend/src/app.ts'), route('/novels'));
  const result = await tsc(join(workspace.path, 'web'));

  assert.notEqual(result.exitCode, 0, 'GET /books no longer exists');
  assert.match(result.stdout, /src\/main\.ts/);
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    '{}\n',
    'A reader derives the document in memory and writes nothing: the committed bytes stay',
  );
});

test('a backend that does not analyze is a diagnostic on the derived document, not a crash', async () => {
  await using workspace = await workspaceDirectory('derived-document-broken-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeFile(
    join(workspace.path, 'backend/src/app.ts'),
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { missing } from './does-not-exist.ts';

export const app = new Hono();

/** @openapi listBooks */
app.get('/books', validate(() => ({})), (c) => c.json(missing));
`,
  );

  const result = await tsc(join(workspace.path, 'web'));

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /backend\.openapi.*error sdk-it4/);
});

test("node --import @sdk-it/content-mapper/register runs a derived document's client, generated from the backend, and leaves the committed document as committed", async () => {
  await using workspace = await workspaceDirectory('derived-register-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeFile(
    join(workspace.path, 'web/src/run.ts'),
    `import { createBackend } from './backend.openapi';

const backend = createBackend({
  baseUrl: 'https://library.test',
  fetch: async (request: Request) =>
    Response.json({ path: new URL(request.url).pathname }),
});
console.log(JSON.stringify(await backend.request('GET /books', {})));
`,
  );

  const result = await runNode([
    '--import',
    '@sdk-it/content-mapper/register',
    join(workspace.path, 'web/src/run.ts'),
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), { path: '/books' });
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    '{}\n',
    'A reader derives the document in memory and writes nothing: the committed bytes stay',
  );
});

/** Makes the workspace an Nx workspace whose backend is the project `backend` (project.json) of the package `@library/backend`. */
async function writeNxWorkspace(root: string, web: Record<string, string>) {
  const files: Record<string, string> = {
    'nx.json': '{}\n',
    'backend/project.json': JSON.stringify({ name: 'backend' }),
    'backend/package.json': JSON.stringify({ name: '@library/backend' }),
    'web/package.json': JSON.stringify({ name: '@library/web' }),
    ...web,
  };
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(root, file), content);
  }
}

test("an app in an Nx workspace with no edge to its backend's project is diagnostic sdk-it5 at the tsconfig's derived option, naming the project", async () => {
  await using workspace = await workspaceDirectory('derived-nx-no-edge-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeNxWorkspace(workspace.path, {});

  const result = await tsc(join(workspace.path, 'web'));

  assert.notEqual(result.exitCode, 0);
  assert.match(
    result.stdout,
    /tsconfig\.json.*error sdk-it5: .*"backend".*implicitDependencies/,
  );
});

test("an app that names its backend's project in implicitDependencies has no Nx edge diagnostic", async () => {
  await using workspace = await workspaceDirectory('derived-nx-implicit-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeNxWorkspace(workspace.path, {
    'web/project.json': JSON.stringify({ implicitDependencies: ['backend'] }),
  });

  const result = await tsc(join(workspace.path, 'web'));

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
});

test("an app that depends on its backend's package has no Nx edge diagnostic", async () => {
  await using workspace = await workspaceDirectory('derived-nx-package-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeNxWorkspace(workspace.path, {
    'web/package.json': JSON.stringify({
      name: '@library/web',
      devDependencies: { '@library/backend': '*' },
    }),
  });

  const result = await tsc(join(workspace.path, 'web'));

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
});

test("an app whose implicitDependencies hold a glob has no Nx edge diagnostic, since Nx's matching may name the backend", async () => {
  await using workspace = await workspaceDirectory('derived-nx-glob-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeNxWorkspace(workspace.path, {
    'web/project.json': JSON.stringify({ implicitDependencies: ['back*'] }),
  });

  const result = await tsc(join(workspace.path, 'web'));

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
});

test("a backend with no project.json is named by its package.json's nx.name before its package name", async () => {
  await using workspace = await workspaceDirectory('derived-nx-name-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeFile(join(workspace.path, 'nx.json'), '{}\n');
  await writeFile(
    join(workspace.path, 'backend/package.json'),
    JSON.stringify({ name: '@library/backend', nx: { name: 'api' } }),
  );
  await writeFile(
    join(workspace.path, 'web/package.json'),
    JSON.stringify({ name: '@library/web' }),
  );

  const result = await tsc(join(workspace.path, 'web'));

  assert.match(result.stdout, /error sdk-it5: .*"api"/);
});

test("DerivedDocument.declaredBy gives each document a tsconfig derives, and derive gives the backend's document as text, the same each time, with the files it read, writing nothing", async () => {
  await using workspace = await workspaceDirectory('derived-api-');
  await writeWorkspace(workspace.path, usesBooks);

  const documents = await DerivedDocument.declaredBy(
    join(workspace.path, 'web/tsconfig.json'),
  );
  const [document] = documents;
  assert.ok(document);
  const first = await document.derive();
  const second = await document.derive();

  assert.deepStrictEqual(
    documents.map(({ path, definition }) => ({ path, definition })),
    [
      {
        path: join(workspace.path, 'web/src/backend.openapi'),
        definition: join(workspace.path, 'backend/openapi.ts'),
      },
    ],
  );
  assert.equal(first.kind, 'derived');
  assert.ok(first.kind === 'derived' && second.kind === 'derived');
  assert.deepStrictEqual(Object.keys(JSON.parse(first.text).paths), ['/books']);
  assert.equal(first.text, second.text, 'Two derivations give the same bytes');
  assert.ok(first.text.endsWith('}\n'));
  assert.ok(first.sources.includes(join(workspace.path, 'backend/openapi.ts')));
  assert.ok(first.sources.includes(join(workspace.path, 'backend/src/app.ts')));
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    '{}\n',
    'Deriving writes nothing',
  );
});

test('derive of a backend that does not analyze is failed with the analysis message, and writes nothing', async () => {
  await using workspace = await workspaceDirectory('derived-api-broken-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeFile(
    join(workspace.path, 'backend/src/app.ts'),
    `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { missing } from './does-not-exist.ts';

export const app = new Hono();

/** @openapi listBooks */
app.get('/books', validate(() => ({})), (c) => c.json(missing));
`,
  );
  const [document] = await DerivedDocument.declaredBy(
    join(workspace.path, 'web/tsconfig.json'),
  );
  assert.ok(document);

  const derivation = await document.derive();

  assert.equal(derivation.kind, 'failed');
  assert.match(
    derivation.kind === 'failed' ? derivation.message : '',
    /does-not-exist/,
  );
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    '{}\n',
  );
});

test('DerivedDocument.at gives the declaration of a derived path, and undefined for a document no tsconfig derives', async () => {
  await using workspace = await workspaceDirectory('derived-api-at-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeFile(join(workspace.path, 'web/src/plain.openapi'), '{}\n');

  const derived = await DerivedDocument.at(
    join(workspace.path, 'web/src/backend.openapi'),
  );
  const plain = await DerivedDocument.at(
    join(workspace.path, 'web/src/plain.openapi'),
  );

  assert.equal(derived?.definition, join(workspace.path, 'backend/openapi.ts'));
  assert.equal(plain, undefined);
});

test('derive with a definition module that does not exist is failed naming the module, not a throw', async () => {
  await using workspace = await workspaceDirectory('derived-api-missing-');
  await writeWorkspace(workspace.path, usesBooks);
  await writeFile(
    join(workspace.path, 'web/tsconfig.json'),
    (await readFile(join(workspace.path, 'web/tsconfig.json'), 'utf8')).replace(
      '../backend/openapi.ts',
      '../backend/missing.ts',
    ),
  );
  const [document] = await DerivedDocument.declaredBy(
    join(workspace.path, 'web/tsconfig.json'),
  );
  assert.ok(document);

  const derivation = await document.derive();

  assert.equal(derivation.kind, 'failed');
  assert.match(
    derivation.kind === 'failed' ? derivation.message : '',
    /missing\.ts/,
  );
});

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** The TypeScript 7.1 language server over `dir`, content mappers on, with `file` open. */
async function languageServer(dir: string, file: string, text: string) {
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
    workspaceFolders: [{ uri: root, name: 'derived' }],
    initializationOptions: { runExternalCode: true },
    capabilities: {
      textDocument: { definition: { linkSupport: false }, diagnostic: {} },
    },
  });
  await connection.sendNotification('initialized', {});
  const uri = pathToFileURL(file).href;
  await connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  });
  await connection.sendRequest('textDocument/diagnostic', {
    textDocument: { uri },
  });
  return {
    definition: (position: { line: number; character: number }) =>
      connection.sendRequest<{ uri: string; range: LspRange }[]>(
        'textDocument/definition',
        { textDocument: { uri }, position },
      ),
    async [Symbol.asyncDispose]() {
      connection.dispose();
      server.kill();
      await once(server, 'close');
    },
  };
}

test("go to definition on a derived document's client lands on where a stale committed copy declares it, at the copy's own offsets", async () => {
  await using workspace = await workspaceDirectory('derived-definition-');
  await writeWorkspace(workspace.path, usesBooks);
  const [document] = await DerivedDocument.declaredBy(
    join(workspace.path, 'web/tsconfig.json'),
  );
  const derivation = await document?.derive();
  assert.ok(derivation?.kind === 'derived');
  // A stale copy that still declares every name, one line lower than the
  // derivation: the mapping must land in these bytes, not the derivation's.
  const stale = derivation.text.replace('{\n', '{\n  "x-stale": true,\n');
  await writeFile(join(workspace.path, 'web/src/backend.openapi'), stale);
  const main = join(workspace.path, 'web/src/main.ts');
  await using server = await languageServer(
    join(workspace.path, 'web'),
    main,
    usesBooks,
  );

  const line = usesBooks
    .split('\n')
    .findIndex((text) => text.includes('createBackend('));
  const character =
    (usesBooks.split('\n')[line] ?? '').indexOf('createBackend') + 1;
  const found = await server.definition({ line, character });

  const committed = stale.split('\n');
  assert.deepStrictEqual(
    found.map(({ uri, range }) => ({
      file: fileURLToPath(uri),
      text: (committed[range.start.line] ?? '').trim(),
    })),
    [
      {
        file: join(workspace.path, 'web/src/backend.openapi'),
        text: '"title": "Library",',
      },
    ],
  );
});
