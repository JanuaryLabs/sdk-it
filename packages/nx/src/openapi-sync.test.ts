import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DerivedDocument } from '@sdk-it/content-mapper';
import { runNode, workspaceDirectory } from '@sdk-it/testing';

const nxBin = join(
  dirname(fileURLToPath(import.meta.resolve('nx/package.json'))),
  'dist/bin/nx.js',
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

/**
 * An Nx workspace whose sync.globalGenerators names @sdk-it/nx:openapi-sync:
 * the project backend with its openapi.ts, and the project web, whose
 * tsconfig.app.json derives src/backend.openapi from it. The committed
 * document starts as `{}`.
 */
async function writeWorkspace(root: string) {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'library', private: true }),
    'nx.json': JSON.stringify({
      sync: { globalGenerators: ['@sdk-it/nx:openapi-sync'] },
    }),
    'backend/project.json': JSON.stringify({ name: 'backend' }),
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
    'web/project.json': JSON.stringify({ name: 'web' }),
    'web/tsconfig.app.json': JSON.stringify({
      compilerOptions: { module: 'nodenext', strict: true, noEmit: true },
      contentMappers: [
        {
          package: '@sdk-it/content-mapper',
          extensions: ['.openapi'],
          options: {
            derived: { 'src/backend.openapi': '../backend/openapi.ts' },
          },
        },
      ],
      include: ['src/**/*.ts', 'src/backend.openapi'],
    }),
    'web/src/backend.openapi': '{}\n',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
}

function nx(root: string, ...args: string[]) {
  return runNode([nxBin, ...args], {
    env: {
      ...process.env,
      NX_WORKSPACE_ROOT_PATH: root,
      NX_DAEMON: 'false',
      NX_NO_CLOUD: 'true',
      CI: 'true',
    },
  });
}

test("nx sync writes each stale derived document a project's tsconfig declares, with the bytes its backend derives", async () => {
  await using workspace = await workspaceDirectory('nx-openapi-sync-');
  await writeWorkspace(workspace.path);

  const result = await nx(workspace.path, 'sync');

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const [document] = await DerivedDocument.declaredBy(
    join(workspace.path, 'web/tsconfig.app.json'),
  );
  const derivation = await document?.derive();
  assert.ok(derivation?.kind === 'derived');
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    derivation.text,
  );
});

test('nx sync writes the derived document of every project, two apps of one backend included', async () => {
  await using workspace = await workspaceDirectory('nx-openapi-sync-apps-');
  await writeWorkspace(workspace.path);
  await mkdir(join(workspace.path, 'admin/src'), { recursive: true });
  await writeFile(
    join(workspace.path, 'admin/project.json'),
    JSON.stringify({ name: 'admin' }),
  );
  await writeFile(
    join(workspace.path, 'admin/tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'nodenext', strict: true, noEmit: true },
      contentMappers: [
        {
          package: '@sdk-it/content-mapper',
          extensions: ['.openapi'],
          options: {
            derived: { 'src/backend.openapi': '../backend/openapi.ts' },
          },
        },
      ],
      include: ['src/**/*.ts', 'src/backend.openapi'],
    }),
  );
  await writeFile(join(workspace.path, 'admin/src/backend.openapi'), '{}\n');

  const result = await nx(workspace.path, 'sync');

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const [document] = await DerivedDocument.declaredBy(
    join(workspace.path, 'web/tsconfig.app.json'),
  );
  const derivation = await document?.derive();
  assert.ok(derivation?.kind === 'derived');
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    derivation.text,
  );
  assert.equal(
    await readFile(join(workspace.path, 'admin/src/backend.openapi'), 'utf8'),
    derivation.text,
  );
});

test('nx sync:check names a stale derived document and exits 1, and exits 0 once nx sync wrote it', async () => {
  await using workspace = await workspaceDirectory('nx-openapi-sync-check-');
  await writeWorkspace(workspace.path);

  const stale = await nx(workspace.path, 'sync:check');
  await nx(workspace.path, 'sync');
  const fresh = await nx(workspace.path, 'sync:check');

  assert.equal(stale.exitCode, 1, stale.stdout + stale.stderr);
  assert.match(stale.stdout + stale.stderr, /web\/src\/backend\.openapi/);
  assert.equal(fresh.exitCode, 0, fresh.stdout + fresh.stderr);
});

test('a backend that does not analyze fails nx sync with the analysis message, naming the document', async () => {
  await using workspace = await workspaceDirectory('nx-openapi-sync-broken-');
  await writeWorkspace(workspace.path);
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

  const result = await nx(workspace.path, 'sync');

  assert.notEqual(result.exitCode, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /web\/src\/backend\.openapi/);
  assert.match(output, /does-not-exist/);
  assert.equal(
    await readFile(join(workspace.path, 'web/src/backend.openapi'), 'utf8'),
    '{}\n',
    'A document whose backend does not analyze is left as committed',
  );
});
