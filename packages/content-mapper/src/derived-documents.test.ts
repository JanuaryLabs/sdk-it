import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

test("tsc types an import of a derived document from the backend's routes, and writes the document from them", async () => {
  await using workspace = await workspaceDirectory('derived-document-');
  await writeWorkspace(workspace.path, usesBooks);

  const result = await tsc(join(workspace.path, 'web'));

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const document = JSON.parse(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
  );
  assert.deepStrictEqual(Object.keys(document.paths), ['/books']);
  assert.equal(document.info.title, 'Library');
});

test('a backend route that changes is what the next tsc run types the import by', async () => {
  await using workspace = await workspaceDirectory('derived-document-change-');
  await writeWorkspace(workspace.path, usesBooks);
  assert.equal((await tsc(join(workspace.path, 'web'))).exitCode, 0);

  await writeFile(join(workspace.path, 'backend/src/app.ts'), route('/novels'));
  const result = await tsc(join(workspace.path, 'web'));

  assert.notEqual(result.exitCode, 0, 'GET /books no longer exists');
  assert.match(result.stdout, /src\/main\.ts/);
  const document = JSON.parse(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
  );
  assert.deepStrictEqual(Object.keys(document.paths), ['/novels']);
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
