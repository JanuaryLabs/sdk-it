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
