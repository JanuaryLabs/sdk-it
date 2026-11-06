import {
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
} from '@typescript/native/ast/is';
import { API, SymbolFlags } from '@typescript/native/sync';
import { TemporaryFiles } from '@zukhruf/testing/fs';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { analysisWorkspace, parseErrorFor, typecheck } from '@sdk-it/testing';
import { render, renderModule } from '@sdk-it/typescript';

function petsSpec(options: {
  servers: string[];
  secured: boolean;
}): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    servers: options.servers.map((url) => ({ url })),
    ...(options.secured ? { security: [{ key: [] }] } : {}),
    components: {
      ...(options.secured
        ? {
            securitySchemes: {
              key: { type: 'apiKey', in: 'header', name: 'x-key' },
            },
          }
        : {}),
      schemas: {
        Pet: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' }, owner: { type: 'string' } },
        },
        Ok: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string' } },
        },
      },
    },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          tags: ['pets'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'hasMore'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Pet' },
                      },
                      hasMore: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          tags: ['pets'],
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
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            '404': {
              description: 'Not Found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Ok' },
                },
              },
            },
          },
        },
      },
    },
  };
}

/** What each of `files` exports, as `value <name>` or `type <name>`, the way TypeScript resolves it. */
function exportsOf(tsconfig: string, files: string[]) {
  using api = new API();
  const parsed = api.parseConfigFile(tsconfig);
  using program = api.createProgram(parsed.fileNames, parsed.options);
  const { checker } = program.getProject();
  return files.map((file) => {
    const source = program.getSourceFile(file);
    assert.ok(source, `${file} is not in the program`);
    const module = checker.getSymbolAtLocation(source);
    assert.ok(module, `${file} is not a module`);
    return checker
      .getExportsOfModule(module)
      .map((exported) => {
        const target =
          exported.flags & SymbolFlags.Alias
            ? checker.getAliasedSymbol(exported)
            : exported;
        const kind = target.flags & SymbolFlags.Value ? 'value' : 'type';
        return `${kind} ${exported.name}`;
      })
      .sort();
  });
}

/** The modules `file` imports or re-exports from, sorted. */
function importsOf(tsconfig: string, file: string) {
  using api = new API();
  const parsed = api.parseConfigFile(tsconfig);
  using program = api.createProgram(parsed.fileNames, parsed.options);
  const source = program.getSourceFile(file);
  assert.ok(source, `${file} is not in the program`);
  return source.statements
    .flatMap((statement) =>
      (isImportDeclaration(statement) || isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [],
    )
    .sort();
}

void test('a spec whose names are runtime and global names keeps them: the one module type-checks, exports the spec models, calls the yielded runtime Page __Page and serves requests', async () => {
  const names = [
    'Pagination',
    'Route',
    'Page',
    'Client',
    'Dispatcher',
    'Response',
    'Date',
    'Blob',
    'Record',
    'ReadableStream',
  ];
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Store', version: '1.0.0' },
    servers: [{ url: 'https://store.test' }],
    components: {
      schemas: Object.fromEntries(
        names.map((name) => [
          name,
          {
            type: 'object',
            required: ['label'],
            properties: { label: { type: 'string' } },
          },
        ]),
      ),
    },
    paths: {
      '/settings': {
        get: {
          operationId: 'settings',
          tags: ['settings'],
          parameters: [
            {
              name: 'label',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: names.map((name) => name.toLowerCase()),
                    properties: Object.fromEntries(
                      names.map((name) => [
                        name.toLowerCase(),
                        { $ref: `#/components/schemas/${name}` },
                      ]),
                    ),
                  },
                },
              },
            },
          },
        },
      },
      '/pages': {
        get: {
          operationId: 'listPages',
          tags: ['settings'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'hasMore'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Page' },
                      },
                      hasMore: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/days': {
        post: {
          operationId: 'markDay',
          tags: ['settings'],
          parameters: [
            {
              name: 'since',
              in: 'query',
              schema: {
                type: 'string',
                format: 'date-time',
                'x-zod-type': 'coerce-date',
                default: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['day'],
                  properties: { day: { $ref: '#/components/schemas/Date' } },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
  };
  const { text } = await renderModule(spec, { name: 'Store' });
  await using workspace = await analysisWorkspace('one-module-collisions-', {
    'store.ts': text,
    'consumer.ts': `import { type Pagination, type Route, type Response, createStore } from './store.ts';
const store = createStore({ baseUrl: 'https://store.test', fetch: (request) => fetch(request) });
const result = await store.request('GET /settings', { label: 'x' });
const pagination: Pagination = result.pagination;
const route: Route = { label: result.route.label };
const response: Response = { label: pagination.label + route.label };
export { response };
`,
    'wrong.ts': `import { store } from './store.ts';
const pages: number = await store.request('GET /pages', {});
export { pages };
`,
  });

  const { diagnostics } = typecheck(workspace.tsconfig);
  const { createStore } = await import(
    pathToFileURL(join(workspace.path, 'store.ts')).href
  );
  const store = createStore({
    baseUrl: 'https://store.test',
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/days') {
        return Response.json({
          since: url.searchParams.get('since'),
          ...(await request.json()),
        });
      }
      const label = url.searchParams.get('label');
      return Response.json(
        Object.fromEntries(
          names.map((name) => [
            name.toLowerCase(),
            { label: `${name}:${label}` },
          ]),
        ),
      );
    },
  });
  const result = await store.request('GET /settings', { label: 'x' });
  const marked = await store.request('POST /days', { day: { label: 'd' } });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.equal(diagnostics[0].file, join(workspace.path, 'wrong.ts'));
  assert.match(diagnostics[0].message, /'__Page<ListPages, Page>'/);
  assert.deepEqual(
    result,
    Object.fromEntries(
      names.map((name) => [name.toLowerCase(), { label: `${name}:x` }]),
    ),
  );
  assert.deepEqual(marked, {
    since: '2026-01-01T00:00:00.000Z',
    day: { label: 'd' },
  });
});

void test('the one module needs no @sdk-it package: it loads and serves a request while every @sdk-it import is refused', async () => {
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Notes', version: '1.0.0' },
    paths: {
      '/notes/{id}': {
        get: {
          operationId: 'getNote',
          tags: ['notes'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: { id: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const { text } = await renderModule(spec, { name: 'Notes' });
  await using workspace = await analysisWorkspace('one-module-no-sdk-it-', {
    'notes.ts': text,
  });
  const inside = pathToFileURL(`${workspace.path}/`).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier.startsWith('@sdk-it/') &&
        context.parentURL?.startsWith(inside)
      ) {
        throw new Error(`${context.parentURL} imports ${specifier}`);
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const { createNotes } = await import(
      pathToFileURL(join(workspace.path, 'notes.ts')).href
    );
    const notes = createNotes({
      baseUrl: 'https://notes.test',
      fetch: async (request: Request) =>
        Response.json({ id: new URL(request.url).pathname.split('/').at(-1) }),
    });

    const note = await notes.request('GET /notes/{id}', { id: 'n1' });

    assert.deepEqual(note, { id: 'n1' });
    // Type stripping erases a type-only import before the hook sees it.
    assert.deepEqual(
      importsOf(workspace.tsconfig, join(workspace.path, 'notes.ts')),
      ['fast-content-type-parse', 'zod'],
    );
  } finally {
    hooks.deregister();
  }
});

void test('the one module exports exactly what the SDK root exports, for a secured spec with one server, an open spec with none and a spec with two', async () => {
  const always = [
    'type ClientError',
    'type Pet',
    'type PetsClient',
    'type PetsEndpoints',
    'type PetsSettings',
    'value APIError',
    'value NotFound',
    'value ParseError',
    'value createPets',
    'value listPetsSchema',
    'value parseInput',
    'value prepare',
    'value request',
  ];
  const variants = {
    'secured, one server': {
      spec: petsSpec({ servers: ['https://pets.test'], secured: true }),
      present: [
        'type PetsCredentials',
        'type SecurityContext',
        'value pets',
        'value servers',
      ],
      absent: [],
    },
    'open, no server': {
      spec: petsSpec({ servers: [], secured: false }),
      present: ['value pets'],
      absent: ['type SecurityContext', 'value servers'],
    },
    'two servers': {
      spec: petsSpec({
        servers: ['https://a.pets.test', 'https://b.pets.test'],
        secured: false,
      }),
      present: ['value servers'],
      absent: ['value pets'],
    },
  };
  for (const [variant, { spec, present, absent }] of Object.entries(variants)) {
    const files = await render(spec, {
      name: 'Pets',
      style: { name: 'github' },
      useTsExtension: true,
    });
    const { text } = await renderModule(spec, { name: 'Pets' });
    await using workspace = await analysisWorkspace('one-module-exports-', {
      'pets.ts': text,
      ...Object.fromEntries(
        Object.entries(files).map(([path, source]) => [`sdk/${path}`, source]),
      ),
    });

    const [moduleExports, sdkExports] = exportsOf(workspace.tsconfig, [
      join(workspace.path, 'pets.ts'),
      join(workspace.path, 'sdk/index.ts'),
    ]);

    assert.deepEqual(moduleExports, sdkExports, variant);
    for (const name of [...always, ...present]) {
      assert.ok(moduleExports.includes(name), `${variant}: ${name}`);
    }
    for (const name of absent) {
      assert.ok(!moduleExports.includes(name), `${variant}: no ${name}`);
    }
  }
});

void test('a consumer of the one module gets typed endpoints: a route returns its model, an unknown route, a wrong input and a wrong output do not type-check', async () => {
  const { text } = await renderModule(
    petsSpec({ servers: ['https://pets.test'], secured: true }),
    { name: 'Pets' },
  );
  await using workspace = await analysisWorkspace('one-module-types-', {
    'pets.ts': text,
    'consumer.ts': `import { type Pet, type PetsEndpoints, pets } from './pets.ts';
const pet: Pet = await pets.request('GET /pets/{petId}', { petId: 'p1' });
const output: PetsEndpoints['GET /pets/{petId}']['output'] = pet;
// @ts-expect-error the spec has no such route
await pets.request('GET /owners', {});
// @ts-expect-error the route returns a Pet
const wrong: number = await pets.request('GET /pets/{petId}', { petId: 'p1' });
// @ts-expect-error petId is a string
await pets.request('GET /pets/{petId}', { petId: 1 });
export { output, wrong };
`,
  });

  const { diagnostics } = typecheck(workspace.tsconfig);

  assert.deepEqual(diagnostics, []);
});

void test('the one module runs the client: the default instance targets the spec server, credentials reach their header, a page fetches the next one and a 404 rejects with the module NotFound', async () => {
  const { text } = await renderModule(
    petsSpec({ servers: ['https://pets.test/v1'], secured: true }),
    { name: 'Pets' },
  );
  await using workspace = await analysisWorkspace('one-module-runs-', {
    'pets.ts': text,
  });
  const { NotFound, createPets, pets } = await import(
    pathToFileURL(join(workspace.path, 'pets.ts')).href
  );
  const client = createPets({
    baseUrl: 'https://pets.test/v1',
    credentials: { key: 'secret' },
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/v1/pets') {
        const offset = Number(url.searchParams.get('offset'));
        const ids = offset === 0 ? ['a', 'b'] : offset === 2 ? ['c'] : [];
        return Response.json({
          data: ids.map((id) => ({ id })),
          hasMore: offset === 0,
        });
      }
      const id = url.pathname.split('/').at(-1);
      if (id === 'missing') {
        return Response.json({ reason: 'adopted' }, { status: 404 });
      }
      return Response.json({ id, owner: request.headers.get('x-key') });
    },
  });

  pets.setOptions({ credentials: { key: 'secret' } });
  const prepared = await pets.prepare('GET /pets/{petId}', { petId: 'p1' });
  const pet = await client.request('GET /pets/{petId}', { petId: 'p1' });
  const first = await client.request('GET /pets', {});
  const second = await first.getNextPage();
  const missing = await client
    .request('GET /pets/{petId}', { petId: 'missing' })
    .catch((error: unknown) => error);

  assert.equal(prepared.url.href, 'https://pets.test/v1/pets/p1');
  assert.deepEqual(pet, { id: 'p1', owner: 'secret' });
  assert.deepEqual(first.data, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(first.hasNextPage(), true);
  assert.deepEqual(second.data, [{ id: 'c' }]);
  assert.ok(missing instanceof NotFound);
  assert.deepEqual(missing.data, { reason: 'adopted' });
});

void test('the one module declares a recursive schema and a shared schema with a date default before the inputs that use them: a valid body is sent with its default, an invalid one rejects with ParseError', async () => {
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Trees', version: '1.0.0' },
    components: {
      schemas: {
        Node: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            children: {
              type: 'array',
              items: { $ref: '#/components/schemas/Node' },
            },
          },
        },
        Window: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              format: 'date-time',
              'x-zod-type': 'coerce-date',
              default: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      },
    },
    paths: {
      '/trees': {
        post: {
          operationId: 'plantTree',
          tags: ['trees'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['root', 'window'],
                  properties: {
                    root: { $ref: '#/components/schemas/Node' },
                    window: { $ref: '#/components/schemas/Window' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
  };
  const { text } = await renderModule(spec, { name: 'Trees' });
  await using workspace = await analysisWorkspace('one-module-order-', {
    'trees.ts': text,
  });
  const { createTrees } = await import(
    pathToFileURL(join(workspace.path, 'trees.ts')).href
  );
  const trees = createTrees({
    baseUrl: 'https://trees.test',
    fetch: async (request: Request) => Response.json(await request.json()),
  });

  const planted = await trees.request('POST /trees', {
    root: { name: 'oak', children: [{ name: 'acorn' }] },
    window: {},
  });

  assert.deepEqual(planted, {
    root: { name: 'oak', children: [{ name: 'acorn' }] },
    window: { from: '2026-01-01T00:00:00.000Z' },
  });
  await assert.rejects(
    trees.request('POST /trees', { root: { children: [] }, window: {} }),
    parseErrorFor('root'),
  );
});

void test('without a name collision the one module keeps the runtime names, so a type error names the Page type', async () => {
  const { text } = await renderModule(
    petsSpec({ servers: ['https://pets.test'], secured: false }),
    { name: 'Pets' },
  );
  await using workspace = await analysisWorkspace('one-module-real-names-', {
    'pets.ts': text,
    'consumer.ts': `import { pets } from './pets.ts';
const page: number = await pets.request('GET /pets', {});
export { page };
`,
  });

  const { diagnostics } = typecheck(workspace.tsconfig);

  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /'Page<\w+, Pet>'/);
});

void test('the one module sends a multipart upload with its Blob, reads an attachment as a Blob and a stream as a ReadableStream, and types an event stream', async () => {
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Files', version: '1.0.0' },
    paths: {
      '/files': {
        post: {
          operationId: 'uploadFile',
          tags: ['files'],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file', 'name'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name', 'content'],
                    properties: {
                      name: { type: 'string' },
                      content: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/files/{id}': {
        get: {
          operationId: 'downloadFile',
          tags: ['files'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              headers: {
                'Content-Disposition': { schema: { type: 'string' } },
              },
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
      },
      '/logs': {
        get: {
          operationId: 'tailLogs',
          tags: ['files'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
      },
      '/events': {
        get: {
          operationId: 'streamEvents',
          tags: ['files'],
          responses: {
            '200': {
              description: 'OK',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },
    },
  };
  const { text } = await renderModule(spec, { name: 'Files' });
  await using workspace = await analysisWorkspace('one-module-bodies-', {
    'files.ts': text,
    'consumer.ts': `import { createFiles } from './files.ts';
const files = createFiles({ baseUrl: 'https://files.test' });
const uploaded: { name: string; content: string } = await files.request('POST /files', { file: new Blob(['x']), name: 'a.txt' });
const downloaded: Blob = await files.request('GET /files/{id}', { id: 'f1' });
const logs: ReadableStream = await files.request('GET /logs', {});
const listen: (eventType: string) => AsyncIterable<string> = await files.request('GET /events', {});
// @ts-expect-error an event stream is not a string
const events: string = await files.request('GET /events', {});
export { uploaded, downloaded, logs, listen, events };
`,
  });
  const { createFiles } = await import(
    pathToFileURL(join(workspace.path, 'files.ts')).href
  );
  const files = createFiles({
    baseUrl: 'https://files.test',
    fetch: async (request: Request) => {
      if (request.method === 'POST') {
        const form = await request.formData();
        const file = form.get('file');
        return Response.json({
          name: form.get('name'),
          content: file instanceof Blob ? await file.text() : 'not a file',
        });
      }
      const { pathname } = new URL(request.url);
      if (pathname === '/events') {
        return new Response(`event: tick\ndata: ${pathname}\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response(new Blob([`bytes of ${pathname}`]), {
        headers: {
          'content-type': 'application/octet-stream',
          ...(pathname === '/logs'
            ? {}
            : { 'content-disposition': 'attachment; filename="f1"' }),
        },
      });
    },
  });

  const { diagnostics } = typecheck(workspace.tsconfig);
  const uploaded = await files.request('POST /files', {
    file: new Blob(['hello']),
    name: 'a.txt',
  });
  const downloaded = await files.request('GET /files/{id}', { id: 'f1' });
  const logs = await files.request('GET /logs', {});
  const listen = await files.request('GET /events', {});
  const ticks = listen('tick')[Symbol.asyncIterator]();

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(uploaded, { name: 'a.txt', content: 'hello' });
  assert.ok(downloaded instanceof Blob);
  assert.equal(await downloaded.text(), 'bytes of /files/f1');
  assert.ok(logs instanceof ReadableStream);
  assert.equal(await new Response(logs).text(), 'bytes of /logs');
  assert.deepEqual(await ticks.next(), { done: false, value: '/events' });
});

void test('renderModule writes nothing and reads nothing outside the repository', async () => {
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  await using workingFolder = await new TemporaryFiles().directory(
    'render-module-no-disk-',
  );
  const script = `
    const { renderModule } = await import(${JSON.stringify(import.meta.resolve('@sdk-it/typescript'))});
    const { text } = await renderModule(${JSON.stringify(petsSpec({ servers: ['https://pets.test'], secured: true }))}, { name: 'Pets' });
    process.stdout.write(String(text.includes('export function createPets(')));
  `;

  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${repoRoot}`,
      '--input-type=module',
      '--eval',
      script,
    ],
    { cwd: workingFolder.path, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'true');
});

void test('renderModule refuses a client name whose default instance would take an SDK root export or the zod binding, naming the clash', async () => {
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Clash', version: '1.0.0' },
    servers: [{ url: 'https://clash.test' }],
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          tags: ['items'],
          responses: { '204': { description: 'No Content' } },
        },
      },
    },
  };

  await assert.rejects(renderModule(spec, { name: 'Request' }), {
    name: 'TypeError',
    message: /\brequest\b/,
  });
  await assert.rejects(renderModule(spec, { name: 'Z' }), {
    name: 'TypeError',
    message: /\bz\b/,
  });
});
