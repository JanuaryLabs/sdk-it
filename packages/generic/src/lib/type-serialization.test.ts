import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze, responseAnalyzer } from '@sdk-it/generic';

async function analyzeWorkspace(
  files: Record<string, string>,
  typesMap?: Record<string, string>,
) {
  await using dir = await new TemporaryFiles().directory(
    'sdk-it-type-serialization-',
  );
  await writeFile(
    join(dir.path, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
      },
      include: ['src/**/*'],
    }),
  );
  for (const [file, content] of Object.entries(files)) {
    const path = join(dir.path, 'src', file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  using project = openAnalysisProject(join(dir.path, 'tsconfig.json'));
  const { paths, components } = await analyze(project, {
    responseAnalyzer,
    ...(typesMap ? { typesMap } : {}),
  });
  // Assert the document as consumers write it to openapi.json.
  return JSON.parse(JSON.stringify({ paths, components }));
}

function jsonResponse(schema: unknown) {
  return {
    '200': {
      description: 'Response for 200',
      content: { 'application/json': { schema } },
    },
  };
}

describe('analyze() serializes declared types', () => {
  test('tuple becomes an array of its element union', async () => {
    const { paths, components } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
const pair: [string, number] = ['a', 1];
app.get('/x', validate(() => ({})), () => {
  return output.json(pair);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'array',
        items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      }),
    );
    assert.deepStrictEqual(components.schemas, {});
  });

  test('class instance becomes a component referenced by $ref', async () => {
    const { paths, components } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
class Book {
  title = '';
  pages: number = 0;
}
app.get('/x', validate(() => ({})), () => {
  return output.json(new Book());
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({ $ref: '#/components/schemas/Book' }),
    );
    assert.deepStrictEqual(components.schemas, {
      Book: {
        type: 'object',
        properties: { pages: { type: 'number' }, title: { type: 'string' } },
        required: ['pages', 'title'],
        additionalProperties: false,
      },
    });
  });

  test('interface keeps inherited members and references nested interfaces', async () => {
    const { paths, components } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
interface Base {
  id: string;
}
interface Author {
  name: string;
}
interface Book extends Base {
  title: string;
  author: Author;
}
declare const book: Book;
app.get('/x', validate(() => ({})), () => {
  return output.json(book);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({ $ref: '#/components/schemas/Book' }),
    );
    assert.deepStrictEqual(components.schemas, {
      Book: {
        type: 'object',
        properties: {
          author: { $ref: '#/components/schemas/Author' },
          id: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['author', 'id', 'title'],
        additionalProperties: false,
      },
      Author: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    });
  });

  test('string enum becomes a union of its member values', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
enum Role {
  Admin = 'admin',
  Reader = 'reader',
}
declare const user: { role: Role };
app.get('/x', validate(() => ({})), () => {
  return output.json(user);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: {
          role: {
            anyOf: [
              { enum: ['admin'], type: 'string' },
              { enum: ['reader'], type: 'string' },
            ],
          },
        },
        required: ['role'],
        additionalProperties: false,
      }),
    );
  });

  test('numeric enum becomes a union of its member values', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
enum Level {
  Low,
  High = 5,
}
declare const item: { level: Level };
app.get('/x', validate(() => ({})), () => {
  return output.json(item);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: {
          level: {
            anyOf: [
              { enum: [0], type: 'number' },
              { enum: [5], type: 'number' },
            ],
          },
        },
        required: ['level'],
        additionalProperties: false,
      }),
    );
  });

  test('string index signature becomes additionalProperties', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare const scores: { [key: string]: number };
app.get('/x', validate(() => ({})), () => {
  return output.json(scores);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        additionalProperties: { type: 'number' },
      }),
    );
  });

  test('generic alias is inlined with its type argument substituted', async () => {
    const { paths, components } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
type Page<T> = { items: T[]; total: number };
type Book = { title: string };
declare const page: Page<Book>;
app.get('/x', validate(() => ({})), () => {
  return output.json(page);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
              additionalProperties: false,
            },
          },
          total: { type: 'number' },
        },
        required: ['items', 'total'],
        additionalProperties: false,
      }),
    );
    assert.deepStrictEqual(components.schemas, {});
  });

  test('Date becomes a date-time string', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare const meeting: { at: Date };
app.get('/x', validate(() => ({})), () => {
  return output.json(meeting);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { at: { type: 'string', format: 'date-time' } },
        required: ['at'],
        additionalProperties: false,
      }),
    );
  });

  test('typesMap entry replaces the declared type', async () => {
    const { paths, components } = await analyzeWorkspace(
      {
        'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
interface Money {
  amount: number;
  currency: string;
}
declare const price: { total: Money };
app.get('/x', validate(() => ({})), () => {
  return output.json(price);
});
export {};
`,
      },
      { Money: 'string' },
    );

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { total: { type: 'string' } },
        required: ['total'],
        additionalProperties: false,
      }),
    );
    assert.deepStrictEqual(components.schemas, {});
  });

  test('discriminated union keeps each variant with its literal discriminator', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number };
declare const shape: Shape;
app.get('/x', validate(() => ({})), () => {
  return output.json(shape);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        anyOf: [
          {
            type: 'object',
            properties: {
              kind: { enum: ['circle'], type: 'string' },
              radius: { type: 'number' },
            },
            required: ['kind', 'radius'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { enum: ['square'], type: 'string' },
              side: { type: 'number' },
            },
            required: ['kind', 'side'],
            additionalProperties: false,
          },
        ],
      }),
    );
  });

  test('property-level as const inside array items keeps its literal while siblings widen', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
app.get('/x', validate(() => ({})), () => {
  return output.json([{ status: 'active' as const, label: 'first' }]);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            status: { enum: ['active'], type: 'string' },
          },
          required: ['label', 'status'],
          additionalProperties: false,
        },
      }),
    );
  });
});

describe('analyze() serializes response expressions', () => {
  test('nullish coalescing takes the combined type', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare const nickname: string | null;
app.get('/x', validate(() => ({})), () => {
  return output.json(nickname ?? 'anonymous');
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({ type: 'string' }),
    );
  });

  test('conditional takes the union of both branches', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare const flag: boolean;
app.get('/x', validate(() => ({})), () => {
  return output.json(flag ? 1 : 'none');
});
export {};
`,
    });

    // Member order is TypeScript 7's stable type ordering.
    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        anyOf: [
          { enum: ['none'], type: 'string' },
          { enum: [1], type: 'number' },
        ],
      }),
    );
  });

  test('non-null assertion drops undefined', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare const maybe: { id: string } | undefined;
app.get('/x', validate(() => ({})), () => {
  return output.json(maybe!);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      }),
    );
  });

  test('await unwraps the promise', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare function load(): Promise<{ id: number }>;
app.get('/x', validate(() => ({})), async () => {
  return output.json(await load());
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
        additionalProperties: false,
      }),
    );
  });

  test('property access takes the property type', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare const store: { books: { title: string }[] };
app.get('/x', validate(() => ({})), () => {
  return output.json(store.books);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
          additionalProperties: false,
        },
      }),
    );
  });

  test('tagged template takes the tag return type', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare function tag(strings: TemplateStringsArray, ...values: unknown[]): { sql: string };
app.get('/x', validate(() => ({})), () => {
  return output.json(tag\`select 1\`);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { sql: { type: 'string' } },
        required: ['sql'],
        additionalProperties: false,
      }),
    );
  });

  test('function reference takes the declared return type', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
function makeBook(): { title: string } {
  return { title: '' };
}
app.get('/x', validate(() => ({})), () => {
  return output.json(makeBook);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      }),
    );
  });

  test('unhandled expression becomes any without affecting sibling routes', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
declare const flag: boolean;
app.get('/x', validate(() => ({})), () => {
  return output.json(!flag);
});
app.get('/y', validate(() => ({})), () => {
  return output.json({ ok: true });
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({ type: 'any' }),
    );
    assert.deepStrictEqual(
      paths['/y'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { ok: { enum: [true], type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      }),
    );
  });
});

describe('analyze() reads routes across the program', () => {
  test('routes in every source file are analyzed, nested folders included', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
app.get('/x', validate(() => ({})), () => {
  return output.json({ a: 1 });
});
export {};
`,
      'nested/more.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
app.get('/y', validate(() => ({})), () => {
  return output.json({ b: 'two' });
});
export {};
`,
    });

    assert.deepStrictEqual(Object.keys(paths).sort(), ['/x', '/y']);
    assert.deepStrictEqual(
      paths['/x'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { a: { enum: [1], type: 'number' } },
        required: ['a'],
        additionalProperties: false,
      }),
    );
    assert.deepStrictEqual(
      paths['/y'].get.responses,
      jsonResponse({
        type: 'object',
        properties: { b: { enum: ['two'], type: 'string' } },
        required: ['b'],
        additionalProperties: false,
      }),
    );
  });

  test('JSDoc description keeps an inline {@link} tag as written', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
type Book = { title: string };
/**
 * @openapi getBook
 * @summary Read one book
 * @description Returns a {@link Book} by id
 */
app.get('/x', validate(() => ({})), () => {
  return output.json({ title: '' } as Book);
});
export {};
`,
    });

    assert.deepStrictEqual(paths['/x'].get, {
      operationId: 'getBook',
      parameters: [],
      tags: [],
      summary: 'Read one book',
      description: 'Returns a {@link Book} by id',
      responses: jsonResponse({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      }),
    });
  });

  test('error thrown from a shared self-recursive helper is recorded on every route that calls it', async () => {
    const { paths } = await analyzeWorkspace({
      'index.ts': `
const app = { get: (..._args: unknown[]) => undefined };
const output = { json: (value: unknown) => value };
const validate = (selector: unknown) => selector;
class ProblemDetailsException extends Error {
  constructor(public problem: { status: number; title: string }) {
    super(problem.title);
  }
}
function ensure(depth: number): void {
  if (depth > 3) {
    throw new ProblemDetailsException({ status: 404, title: 'Not found' });
  }
  ensure(depth + 1);
}
app.get('/x', validate(() => ({})), () => {
  ensure(0);
  return output.json({ ok: true });
});
app.get('/y', validate(() => ({})), () => {
  ensure(0);
  return output.json({ ok: true });
});
export {};
`,
    });

    const expected = {
      ...jsonResponse({
        type: 'object',
        properties: { ok: { enum: [true], type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      }),
      '404': {
        description: 'Response for 404',
        content: {
          'application/problem+json': {
            schema: {
              type: 'object',
              properties: {
                status: { enum: [404], type: 'number' },
                title: { enum: ['Not found'], type: 'string' },
              },
              required: ['status', 'title'],
              additionalProperties: false,
            },
          },
        },
      },
    };
    assert.deepStrictEqual(paths['/x'].get.responses, expected);
    assert.deepStrictEqual(paths['/y'].get.responses, expected);
  });
});
