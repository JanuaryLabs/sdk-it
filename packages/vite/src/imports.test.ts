import { waitFor } from '@zukhruf/testing/async';
import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { type Logger, build, createServer } from 'vite';

import { workspaceDirectory } from '@sdk-it/testing';
import sdkIt from '@sdk-it/vite';

const storeDocument = (server: string) => `openapi: 3.1.0
info: { title: Store, version: 1.0.0 }
servers: [{ url: ${server} }]
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
      properties:
        name: { type: string }
`;

const main = `import { store } from './store.openapi.yaml';

export const getPet = (petId: string) =>
  store.request('GET /pets/{petId}', { petId });
`;

function petServer(name: string) {
  return new HttpServer().start((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ name, path: request.url }));
  });
}

async function devServer(root: string) {
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: join(root, '.vite'),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, ws: false },
    plugins: [sdkIt.imports()],
  });
  return Object.assign(server, {
    [Symbol.asyncDispose]: () => server.close(),
  });
}

test('the dev server runs the SDK of an imported OpenAPI document', async () => {
  await using pets = await petServer('Rex');
  await using app = await workspaceDirectory('vite-imports-');
  await writeFile(
    join(app.path, 'store.openapi.yaml'),
    storeDocument(pets.origin),
  );
  await writeFile(join(app.path, 'main.ts'), main);
  await using server = await devServer(app.path);

  const { getPet } = await server.ssrLoadModule('/main.ts');

  assert.deepEqual(await getPet('p1'), { name: 'Rex', path: '/pets/p1' });
});

test('a build bundles the SDK of an imported OpenAPI document', async () => {
  await using pets = await petServer('Rex');
  await using app = await workspaceDirectory('vite-imports-');
  await writeFile(
    join(app.path, 'store.openapi.yaml'),
    storeDocument(pets.origin),
  );
  await writeFile(join(app.path, 'main.ts'), main);
  const outDir = join(app.path, 'dist');

  await build({
    configFile: false,
    root: app.path,
    logLevel: 'silent',
    plugins: [sdkIt.imports()],
    build: { ssr: 'main.ts', outDir, emptyOutDir: true },
  });
  const { getPet } = await import(pathToFileURL(join(outDir, 'main.js')).href);

  assert.deepEqual(await getPet('p1'), { name: 'Rex', path: '/pets/p1' });
});

test(
  'the dev server reloads the module when the imported document changes',
  { timeout: 30_000 },
  async (t) => {
    await using before = await petServer('Rex');
    await using after = await petServer('Fido');
    await using app = await workspaceDirectory('vite-imports-');
    const document = join(app.path, 'store.openapi.yaml');
    await writeFile(document, storeDocument(before.origin));
    await writeFile(join(app.path, 'main.ts'), main);
    await using server = await devServer(app.path);
    const first = await server.ssrLoadModule('/main.ts');
    assert.deepEqual(await first.getPet('p1'), {
      name: 'Rex',
      path: '/pets/p1',
    });

    await writeFile(document, storeDocument(after.origin));

    await waitFor(
      async () => {
        const { getPet } = await server.ssrLoadModule('/main.ts');
        assert.deepEqual(await getPet('p1'), {
          name: 'Fido',
          path: '/pets/p1',
        });
      },
      { signal: t.signal },
    );
  },
);

test('a document whose $ref does not resolve fails the import with the $ref and its line', async () => {
  await using app = await workspaceDirectory('vite-imports-');
  await writeFile(
    join(app.path, 'store.openapi.yaml'),
    storeDocument('https://store.test').replace(
      "{ $ref: '#/components/schemas/Pet' }",
      "{ $ref: './missing.yaml' }",
    ),
  );
  await writeFile(join(app.path, 'main.ts'), main);
  await using server = await devServer(app.path);

  await assert.rejects(server.ssrLoadModule('/main.ts'), (error: Error) => {
    assert.match(error.message, /Could not resolve \$ref \.\/missing\.yaml/);
    assert.deepEqual(
      {
        line: Reflect.get(error, 'loc')?.line,
        column: Reflect.get(error, 'loc')?.column,
      },
      { line: 15, column: 30 },
    );
    return true;
  });
});

test(
  'the dev server reloads the module when a file outside its root that the document references changes',
  { timeout: 30_000 },
  async (t) => {
    await using pets = await petServer('Rex');
    await using app = await workspaceDirectory('vite-imports-');
    const web = join(app.path, 'web');
    const parameters = join(app.path, 'shared', 'parameters.yaml');
    await mkdir(dirname(parameters), { recursive: true });
    await mkdir(web);
    const petId = (pattern: string) =>
      `petId: { name: petId, in: path, required: true, schema: { type: string, pattern: '${pattern}' } }\n`;
    await writeFile(parameters, petId('^p'));
    await writeFile(
      join(web, 'store.openapi.yaml'),
      storeDocument(pets.origin).replace(
        '        - { name: petId, in: path, required: true, schema: { type: string } }',
        "        - $ref: '../shared/parameters.yaml#/petId'",
      ),
    );
    await writeFile(join(web, 'main.ts'), main);
    await using server = await devServer(web);
    const { getPet } = await server.ssrLoadModule('/main.ts');
    await assert.rejects(getPet('x1'));

    await waitFor(
      async () => {
        // Vite starts watching a file added through addWatchFile after load
        // returns, and a write before the watcher is running is lost, so each
        // attempt writes again.
        await writeFile(parameters, petId('^x'));
        const { getPet } = await server.ssrLoadModule('/main.ts');
        assert.deepEqual(await getPet('x1'), { name: 'Rex', path: '/pets/x1' });
      },
      { signal: t.signal },
    );
  },
);

test('a JSON document imported with the .openapi extension runs its SDK', async () => {
  await using pets = await petServer('Rex');
  await using app = await workspaceDirectory('vite-imports-');
  await writeFile(
    join(app.path, 'store.openapi'),
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Store', version: '1.0.0' },
      servers: [{ url: pets.origin }],
      paths: {
        '/pets/{petId}': {
          get: {
            operationId: 'getPet',
            parameters: [
              {
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'A pet',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }),
  );
  await writeFile(
    join(app.path, 'main.ts'),
    main.replace('./store.openapi.yaml', './store.openapi'),
  );
  await using server = await devServer(app.path);

  const { getPet } = await server.ssrLoadModule('/main.ts');

  assert.deepEqual(await getPet('p1'), { name: 'Rex', path: '/pets/p1' });
});

test('a cold dev server pre-bundles the packages that the SDK of an imported document imports, and logs nothing', async () => {
  await using app = await workspaceDirectory('vite-imports-');
  await writeFile(
    join(app.path, 'store.openapi.yaml'),
    storeDocument('https://store.test'),
  );
  await writeFile(join(app.path, 'main.ts'), main);
  await writeFile(
    join(app.path, 'index.html'),
    '<script type="module" src="/main.ts"></script>\n',
  );
  const logs: string[] = [];
  const logger: Logger = {
    hasWarned: false,
    info: (message) => void logs.push(message),
    warn: (message) => void logs.push(message),
    warnOnce: (message) => void logs.push(message),
    error: (message) => void logs.push(message),
    clearScreen: () => undefined,
    hasErrorLogged: () => false,
  };
  const created = await createServer({
    configFile: false,
    root: app.path,
    // The default cache folder is in the nearest node_modules, which every test shares.
    cacheDir: join(app.path, '.vite'),
    customLogger: logger,
    server: { middlewareMode: true, ws: false },
    plugins: [sdkIt.imports()],
  });
  await using server = Object.assign(created, {
    [Symbol.asyncDispose]: () => created.close(),
  });

  const optimizer = server.environments.client.depsOptimizer;
  await optimizer?.scanProcessing;

  assert.deepEqual(
    {
      logs,
      scanned: Object.keys(optimizer?.metadata.discovered ?? {}).toSorted(),
    },
    { logs: [], scanned: ['fast-content-type-parse', 'zod'] },
  );
});

/** A backend with its openapi.ts and an app whose tsconfig derives backend.openapi from it. */
async function derivedWorkspace(root: string, path: string) {
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
    'backend/src/app.ts': backendRoute(path),
    'backend/openapi.ts': `import { defineOpenApi } from '@sdk-it/openapi';

export default defineOpenApi({
  tsconfig: new URL('./tsconfig.json', import.meta.url),
  document: { openapi: '3.1.0', info: { title: 'Library', version: '1.0.0' } },
});
`,
    'web/tsconfig.json': JSON.stringify({
      compilerOptions: { module: 'nodenext', strict: true, noEmit: true },
      contentMappers: [
        {
          package: '@sdk-it/content-mapper',
          extensions: ['.openapi'],
          options: { derived: { 'backend.openapi': '../backend/openapi.ts' } },
        },
      ],
      include: ['*.ts', 'backend.openapi'],
    }),
    'web/backend.openapi': '{}\n',
    'web/main.ts': `import { createBackend } from './backend.openapi';

const backend = createBackend({
  baseUrl: 'https://library.test',
  fetch: async (request: Request) =>
    Response.json({ path: new URL(request.url).pathname }),
});
export const call = (endpoint: string) =>
  backend.request(endpoint as 'GET /books', {});
`,
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
}

function backendRoute(path: string) {
  return `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi listBooks */
app.get('${path}', validate(() => ({})), (c) => c.json([{ id: 'b1' }]));
`;
}

test("the dev server runs a derived document's client, generated from the backend its tsconfig names", async () => {
  await using app = await workspaceDirectory('vite-derived-');
  await derivedWorkspace(app.path, '/books');
  await using server = await devServer(join(app.path, 'web'));

  const { call } = await server.ssrLoadModule('/main.ts');

  assert.deepEqual(await call('GET /books'), { path: '/books' });
});

test(
  'the dev server reloads a derived document when a backend file changes',
  { timeout: 60_000 },
  async (t) => {
    await using app = await workspaceDirectory('vite-derived-reload-');
    await derivedWorkspace(app.path, '/books');
    await using server = await devServer(join(app.path, 'web'));
    const { call } = await server.ssrLoadModule('/main.ts');
    await assert.rejects(call('GET /novels'));

    await waitFor(
      async () => {
        // Vite watches a file added through addWatchFile after load returns,
        // so each attempt writes again.
        await writeFile(
          join(app.path, 'backend/src/app.ts'),
          backendRoute('/novels'),
        );
        const { call } = await server.ssrLoadModule('/main.ts');
        assert.deepEqual(await call('GET /novels'), { path: '/novels' });
      },
      { signal: t.signal },
    );
  },
);

test("a document's module loads by its own URL, which a module from Vitest's file system cache imports without resolving the document first", async () => {
  await using pets = await petServer('Rex');
  await using app = await workspaceDirectory('vite-imports-url-');
  await mkdir(join(app.path, 'src'));
  await writeFile(
    join(app.path, 'src/store.openapi.yaml'),
    storeDocument(pets.origin),
  );
  await using server = await devServer(app.path);

  const { store } = await server.ssrLoadModule('/src/store.openapi.yaml.ts');

  assert.deepEqual(await store.request('GET /pets/{petId}', { petId: 'p1' }), {
    name: 'Rex',
    path: '/pets/p1',
  });
});

test('the dev server runs the SDK of a document imported through a package.json subpath import (#store)', async () => {
  await using pets = await petServer('Rex');
  await using app = await workspaceDirectory('vite-imports-subpath-');
  await writeFile(
    join(app.path, 'package.json'),
    JSON.stringify({
      name: 'app',
      type: 'module',
      imports: { '#store': './store.openapi.yaml' },
    }),
  );
  await writeFile(
    join(app.path, 'store.openapi.yaml'),
    storeDocument(pets.origin),
  );
  await writeFile(
    join(app.path, 'main.ts'),
    main.replace("'./store.openapi.yaml'", "'#store'"),
  );
  await using server = await devServer(app.path);

  const { getPet } = await server.ssrLoadModule('/main.ts');

  assert.deepEqual(await getPet('p1'), { name: 'Rex', path: '/pets/p1' });
});

test('a subpath import of a module that is not a document loads that module unchanged', async () => {
  await using app = await workspaceDirectory('vite-imports-subpath-module-');
  await writeFile(
    join(app.path, 'package.json'),
    JSON.stringify({
      name: 'app',
      type: 'module',
      imports: { '#greeting': './greeting.ts' },
    }),
  );
  await writeFile(
    join(app.path, 'greeting.ts'),
    "export const greeting: string = 'hello';\n",
  );
  await writeFile(
    join(app.path, 'main.ts'),
    "export { greeting } from '#greeting';\n",
  );
  await using server = await devServer(app.path);

  const { greeting } = await server.ssrLoadModule('/main.ts');

  assert.equal(greeting, 'hello');
});
