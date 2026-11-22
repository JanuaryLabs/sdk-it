import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  PrismaClientNotGeneratedError,
  defineOpenApi,
  generateDocument,
} from '@sdk-it/openapi';
import { analysisWorkspace } from '@sdk-it/testing';

const books = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi listBooks @tags books */
app.get(
  '/books',
  validate((payload) => ({
    author: { select: payload.query.author, against: z.string().optional() },
  })),
  (c) => c.json([{ id: 'book-1', title: 'Type Systems' }]),
);

/** @openapi listAuthors @tags authors */
app.get('/authors', validate(() => ({})), (c) => c.json([{ id: 'a1' }]));
`;

test('the document is the base fields, the paths and schemas the analysis finds, and a tag object for each tag with the base fields kept', async () => {
  await using workspace = await analysisWorkspace('openapi-document-', {
    'src/app.ts': books,
  });

  const { document } = await generateDocument(
    defineOpenApi({
      tsconfig: pathToFileURL(workspace.tsconfig),
      document: {
        openapi: '3.1.0',
        info: { title: 'Library API', version: '1.0.0' },
        servers: [{ url: 'https://library.test' }],
        security: [{ bearer: [] }],
        tags: [{ name: 'books', description: 'The catalogue.' }],
        components: {
          securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        },
      },
    }),
  );

  assert.equal(document.openapi, '3.1.0');
  assert.deepStrictEqual(document.info, {
    title: 'Library API',
    version: '1.0.0',
  });
  assert.deepStrictEqual(document.servers, [{ url: 'https://library.test' }]);
  assert.deepStrictEqual(document.security, [{ bearer: [] }]);
  assert.deepStrictEqual(document.components?.securitySchemes, {
    bearer: { type: 'http', scheme: 'bearer' },
  });
  assert.deepStrictEqual(Object.keys(document.paths ?? {}).sort(), [
    '/authors',
    '/books',
  ]);
  assert.ok(document.components?.schemas, 'the analysis schemas are present');
  assert.deepStrictEqual(document.tags, [
    { name: 'books', description: 'The catalogue.' },
    { name: 'authors' },
  ]);
});

test('operation transformers run on every operation in the order given, then document transformers run on the finished document', async () => {
  await using workspace = await analysisWorkspace('openapi-transformers-', {
    'src/app.ts': books,
  });
  const seen: string[] = [];

  const { document } = await generateDocument({
    tsconfig: pathToFileURL(workspace.tsconfig),
    document: { openapi: '3.1.0', info: { title: 'Library', version: '1' } },
    transformers: {
      operation: [
        (operation, { method, path }) => {
          operation.summary = `${method.toUpperCase()} ${path}`;
        },
        async (operation) => {
          operation.summary = `${operation.summary} (checked)`;
        },
      ],
      document: [
        (finished) => {
          seen.push(
            ...Object.values(finished.paths ?? {}).map(
              (item) => item.get?.summary ?? '',
            ),
          );
          finished.info.description = 'Generated from the backend.';
        },
      ],
    },
  });

  assert.deepStrictEqual(seen.sort(), [
    'GET /authors (checked)',
    'GET /books (checked)',
  ]);
  assert.equal(document.info.description, 'Generated from the backend.');
});

test('a route that imports $Enums gets the Prisma preset: its against reads the client and Decimal is a string', async () => {
  await using workspace = await analysisWorkspace('openapi-prisma-', {
    'src/generated/client.d.ts': `export declare namespace Prisma {
  class Decimal {
    constructor(value: string);
  }
}
export declare const $Enums: { Status: { DRAFT: 'DRAFT'; PUBLISHED: 'PUBLISHED' } };
export type Product = { id: string; price: Prisma.Decimal };
`,
    'src/generated/client.js': `export const Prisma = { Decimal: class Decimal {} };
export const $Enums = { Status: { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' } };
`,
    'src/app.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { $Enums, type Product } from './generated/client.js';

export const app = new Hono();

/** @openapi listProducts */
app.get(
  '/products',
  validate((payload) => ({
    status: { select: payload.query.status, against: z.enum($Enums.Status) },
  })),
  (c) => c.json({} as Product),
);
`,
  });

  const { document } = await generateDocument({
    tsconfig: pathToFileURL(workspace.tsconfig),
    document: { openapi: '3.1.0', info: { title: 'Shop', version: '1' } },
  });

  const operation = document.paths?.['/products']?.get;
  const schema = JSON.parse(JSON.stringify(operation?.responses?.['200']))
    .content['application/json'].schema;
  assert.deepStrictEqual(schema.properties.price, { type: 'string' });
  const status = JSON.parse(JSON.stringify(operation?.parameters ?? [])).find(
    (parameter: { name: string }) => parameter.name === 'status',
  );
  assert.deepStrictEqual(status.schema.enum, ['DRAFT', 'PUBLISHED']);
});

test('a route that imports $Enums from a Prisma client that does not load fails with PrismaClientNotGeneratedError naming the route file and the import', async () => {
  await using workspace = await analysisWorkspace('openapi-prisma-missing-', {
    'src/generated/client.d.ts': `export declare const $Enums: { Status: { DRAFT: 'DRAFT' } };
`,
    'src/app.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { $Enums } from './generated/client.js';

export const app = new Hono();

/** @openapi listProducts */
app.get(
  '/products',
  validate((payload) => ({
    status: { select: payload.query.status, against: z.enum($Enums.Status) },
  })),
  (c) => c.json({ ok: true }),
);
`,
  });

  await assert.rejects(
    generateDocument({
      tsconfig: pathToFileURL(workspace.tsconfig),
      document: { openapi: '3.1.0', info: { title: 'Shop', version: '1' } },
    }),
    (error: unknown) => {
      assert.ok(error instanceof PrismaClientNotGeneratedError);
      assert.equal(error.importName, '$Enums');
      assert.match(error.routeFile, /app\.ts$/);
      assert.match(error.message, /prisma generate/);
      return true;
    },
  );
});

test('the source files are the files of the backend the analysis read, and none under node_modules', async () => {
  await using workspace = await analysisWorkspace('openapi-sources-', {
    'src/app.ts': books,
  });

  const { sourceFiles } = await generateDocument({
    tsconfig: pathToFileURL(workspace.tsconfig),
    document: { openapi: '3.1.0', info: { title: 'Library', version: '1' } },
  });

  assert.ok(sourceFiles.some((file) => file.endsWith('/src/app.ts')));
  assert.equal(
    sourceFiles.some((file) => file.includes('/node_modules/')),
    false,
  );
});

test('a middleware security rule names its file by URL and marks the routes the middleware guards', async () => {
  await using workspace = await analysisWorkspace('openapi-security-', {
    'src/auth.ts': `import type { MiddlewareHandler } from 'hono';
export const authenticate = (): MiddlewareHandler => async (_c, next) => {
  await next();
};
`,
    'src/app.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { authenticate } from './auth.ts';

export const app = new Hono();

/** @openapi getAccount */
app.get('/account', authenticate(), validate(() => ({})), (c) => c.json({ id: 'a1' }));

/** @openapi getStatus */
app.get('/status', validate(() => ({})), (c) => c.json({ ok: true }));
`,
  });

  const { document } = await generateDocument({
    tsconfig: pathToFileURL(workspace.tsconfig),
    document: {
      openapi: '3.1.0',
      info: { title: 'Accounts', version: '1' },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      },
    },
    middlewareSecurity: [
      {
        middleware: {
          import: 'authenticate',
          from: new URL('src/auth.ts', pathToFileURL(`${workspace.path}/`)),
        },
        security: [{ bearer: [] }],
      },
    ],
  });

  assert.deepStrictEqual(document.paths?.['/account']?.get?.security, [
    { bearer: [] },
  ]);
  assert.deepStrictEqual(document.paths?.['/status']?.get?.security, []);
});
