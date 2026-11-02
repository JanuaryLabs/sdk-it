import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

const execFileAsync = promisify(execFile);
const tsc = join(
  dirname(
    createRequire(import.meta.url).resolve('@typescript/native/package.json'),
  ),
  'bin/tsc',
);

async function analyzeWorkspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-handler-responses-'));
  try {
    await writeFile(
      join(dir, 'tsconfig.json'),
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
      const path = join(dir, 'src', file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths } = await analyze(project, { responseAnalyzer });
    // Assert the document as consumers write it to openapi.json.
    return JSON.parse(JSON.stringify(paths));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const routing = `
const app = {
  get: (..._args: unknown[]) => undefined,
  post: (..._args: unknown[]) => undefined,
  delete: (..._args: unknown[]) => undefined,
};
const validate = (selector: unknown) => selector;
interface Ctx {
  json(value: unknown, status?: number): Response;
  body(value: unknown, status?: number): Response;
}
declare function flag(): boolean;
`;

describe('analyze() merges the responses a handler returns for one status', () => {
  test('two different octet-stream bodies for one status document one binary body', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
app.get('/files', validate(() => ({})), (c: Ctx) => {
  if (flag()) {
    return c.body('plain text', 200);
  }
  return c.body(new Uint8Array([1]), 200);
});
export {};
`,
    });

    assert.deepStrictEqual(paths['/files'].get.responses['200'].content, {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    });
  });

  test('two different JSON bodies for one status document both as oneOf', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
app.get('/items', validate(() => ({})), (c: Ctx) => {
  if (flag()) {
    return c.json({ kind: 'single' as const, id: 1 }, 200);
  }
  return c.json({ kind: 'list' as const, ids: [1, 2] }, 200);
});
export {};
`,
    });

    const schema =
      paths['/items'].get.responses['200'].content['application/json'].schema;
    assert.deepStrictEqual(
      schema.oneOf.map(
        (branch: { properties: { kind: { enum: string[] } } }) =>
          branch.properties.kind.enum,
      ),
      [['single'], ['list']],
    );
  });

  test('two equal JSON bodies for one status document one schema', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
app.get('/items', validate(() => ({})), (c: Ctx) => {
  if (flag()) {
    return c.json({ id: 1 }, 200);
  }
  return c.json({ id: 1 }, 200);
});
export {};
`,
    });

    const schema =
      paths['/items'].get.responses['200'].content['application/json'].schema;
    assert.strictEqual(schema.oneOf, undefined);
    assert.deepStrictEqual(Object.keys(schema.properties), ['id']);
  });

  test('two branches that return no body document one 204 without content', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  if (flag()) {
    return c.body(null, 204);
  }
  return c.body(null, 204);
});
export {};
`,
    });

    assert.deepStrictEqual(paths['/runs/{id}'].delete.responses['204'], {
      description: 'Response for 204',
    });
  });

  test('a body returned after a no-body branch for the same status is documented', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  if (flag()) {
    return c.body(null, 204);
  }
  return c.body('gone', 204);
});
export {};
`,
    });

    assert.deepStrictEqual(
      paths['/runs/{id}'].delete.responses['204'].content,
      {
        'application/octet-stream': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    );
  });

  test('a delete that calls a store for its side effects documents one 204 without content', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
declare function lookup(id: string): { id: string } | undefined;
declare function remove(id: string): boolean;
const store = {
  getRun(id: string) {
    return lookup(id);
  },
  deleteRun(id: string) {
    return remove(id);
  },
};
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  store.getRun('1');
  store.deleteRun('1');
  return c.body(null, 204);
});
export {};
`,
    });

    assert.deepStrictEqual(paths['/runs/{id}'].delete.responses, {
      '204': { description: 'Response for 204' },
    });
  });
});

function contentTypes(responses: Record<string, { content?: object }>) {
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => [
      status,
      Object.keys(response.content ?? {}),
    ]),
  );
}

describe('analyze() documents a null raw body as no body', () => {
  // c.body() documented no body before the fix too: it is the reference form.
  const forms = [
    { call: 'c.body(null, 204)', status: '204' },
    { call: 'c.body(null, 200)', status: '200' },
    { call: 'c.body(null)', status: '200' },
    { call: 'c.body()', status: '200' },
  ];
  for (const { call, status } of forms) {
    test(`return ${call} documents ${status} without content`, async () => {
      const paths = await analyzeWorkspace({
        'index.ts': `${routing}
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  return ${call};
});
export {};
`,
      });

      assert.deepStrictEqual(paths['/runs/{id}'].delete.responses, {
        [status]: { description: `Response for ${status}` },
      });
    });
  }

  test('return new Response(null, { status: 204 }) documents 204 without content', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  return new Response(null, { status: 204 });
});
export {};
`,
    });

    assert.deepStrictEqual(paths['/runs/{id}'].delete.responses, {
      '204': { description: 'Response for 204' },
    });
  });

  test('return c.json(null) still documents a JSON body', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  return c.json(null);
});
export {};
`,
    });

    assert.deepStrictEqual(contentTypes(paths['/runs/{id}'].delete.responses), {
      '200': ['application/json'],
    });
  });
});

const helpers = `
function streamText(options: { prompt: string }) {
  return { prompt: options.prompt };
}
function summarize(prompt: string) {
  return streamText({ prompt });
}
async function summarizeLater(prompt: string) {
  return streamText({ prompt });
}
declare function send(value: unknown): void;
`;

describe('analyze() ignores what a discarded helper call returns', () => {
  const positions = [
    { position: 'statement', body: `summarize('x');` },
    { position: 'initializer', body: `const stream = summarize('x');` },
    { position: 'argument', body: `send(summarize('x'));` },
  ];
  for (const { position, body } of positions) {
    test(`a helper called as ${position} adds no text/plain response`, async () => {
      const paths = await analyzeWorkspace({
        'index.ts': `${routing}${helpers}
app.post('/sql-agent', validate(() => ({})), (c: Ctx) => {
  ${body}
  return c.json({ output: 'select 1' });
});
export {};
`,
      });

      assert.deepStrictEqual(contentTypes(paths['/sql-agent'].post.responses), {
        '200': ['application/json'],
      });
    });
  }

  const nested = [
    {
      helper: 'returns the inner helper',
      code: `function prepare() { return summarize('x'); }`,
    },
    {
      helper: 'calls the inner helper',
      code: `function prepare() { summarize('x'); return 1; }`,
    },
  ];
  for (const { helper, code } of nested) {
    test(`a discarded helper that ${helper} adds no text/plain response`, async () => {
      const paths = await analyzeWorkspace({
        'index.ts': `${routing}${helpers}
${code}
app.post('/sql-agent', validate(() => ({})), (c: Ctx) => {
  prepare();
  return c.json({ output: 'select 1' });
});
export {};
`,
      });

      assert.deepStrictEqual(contentTypes(paths['/sql-agent'].post.responses), {
        '200': ['application/json'],
      });
    });
  }

  test('a throw two discarded helpers deep is documented', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}${helpers}
class HTTPException extends Error {
  constructor(public status: number, options?: { message: string }) {
    super(options?.message);
  }
}
function ensure(found: boolean) {
  if (!found) {
    throw new HTTPException(404, { message: 'Run not found' });
  }
  return summarize('x');
}
function prepare() {
  ensure(flag());
  return summarize('y');
}
app.post('/sql-agent', validate(() => ({})), (c: Ctx) => {
  prepare();
  return c.json({ output: 'select 1' });
});
export {};
`,
    });

    assert.deepStrictEqual(contentTypes(paths['/sql-agent'].post.responses), {
      '200': ['application/json'],
      '404': ['application/json'],
    });
  });
});

describe('analyze() documents what a returned helper call returns', () => {
  const forms = [
    `return summarize('x');`,
    `return await summarizeLater('x');`,
    `return (summarize('x'));`,
    `return summarize('x') as unknown as Response;`,
    `return summarize('x') satisfies unknown;`,
    `return summarize('x')!;`,
    `return <Response>(<unknown>summarize('x'));`,
    `return flag() ? summarize('x') : summarize('y');`,
  ];
  for (const form of forms) {
    test(`${form} documents the helper's text/plain response`, async () => {
      const paths = await analyzeWorkspace({
        'index.ts': `${routing}${helpers}
app.post('/summary', validate(() => ({})), async (c: Ctx) => {
  ${form}
});
export {};
`,
      });

      assert.deepStrictEqual(contentTypes(paths['/summary'].post.responses), {
        '200': ['text/plain'],
      });
    });
  }

  test('a helper first called for its side effects and then returned documents its text/plain response', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}${helpers}
app.post('/summary', validate(() => ({})), (c: Ctx) => {
  summarize('warm up');
  return summarize('x');
});
export {};
`,
    });

    assert.deepStrictEqual(contentTypes(paths['/summary'].post.responses), {
      '200': ['text/plain'],
    });
  });

  test("a concise handler body documents the helper's text/plain response", async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}${helpers}
app.post('/summary', validate(() => ({})), (c: Ctx) => summarize('x'));
export {};
`,
    });

    assert.deepStrictEqual(contentTypes(paths['/summary'].post.responses), {
      '200': ['text/plain'],
    });
  });

  test('a return inside a nested callback adds no text/plain response', async () => {
    const paths = await analyzeWorkspace({
      'index.ts': `${routing}${helpers}
app.post('/sql-agent', validate(() => ({})), (c: Ctx) => {
  [1].map(() => {
    return summarize('x');
  });
  return c.json({ output: 'select 1' });
});
export {};
`,
    });

    assert.deepStrictEqual(contentTypes(paths['/sql-agent'].post.responses), {
      '200': ['application/json'],
    });
  });
});

/**
 * An app whose tsconfig references a composite workspace package, the way an
 * Nx monorepo wires an app to its libraries. The package's exports point at a
 * dist folder that is never built, so the analyzer can only reach the
 * package through its source.
 */
async function analyzeWithReference(
  app: string,
  library: string,
  through: 'directory' | 'symlink' = 'directory',
) {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-handler-references-'));
  const links = await mkdtemp(join(tmpdir(), 'sdk-it-handler-links-'));
  try {
    const compilerOptions = {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
    };
    const files: Record<string, string> = {
      'tsconfig.json': JSON.stringify({
        compilerOptions,
        include: ['src/**/*'],
        references: [{ path: './packages/runs' }],
      }),
      'src/index.ts': app,
      'packages/runs/package.json': JSON.stringify({
        name: '@ws/runs',
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        },
      }),
      'packages/runs/tsconfig.json': JSON.stringify({
        compilerOptions: {
          ...compilerOptions,
          composite: true,
          declaration: true,
          rootDir: 'src',
          outDir: 'dist',
        },
        include: ['src/**/*'],
      }),
      'packages/runs/src/index.ts': library,
    };
    for (const [file, content] of Object.entries(files)) {
      const path = join(dir, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    await mkdir(join(dir, 'node_modules/@ws'), { recursive: true });
    await symlink(
      join(dir, 'packages/runs'),
      join(dir, 'node_modules/@ws/runs'),
      'dir',
    );
    // The app imports the built declarations, as after the monorepo's build.
    await execFileAsync(process.execPath, [
      tsc,
      '--build',
      join(dir, 'packages/runs'),
    ]);
    let root = dir;
    if (through === 'symlink') {
      root = join(links, 'workspace');
      await symlink(dir, root, 'dir');
    }
    using project = openAnalysisProject(join(root, 'tsconfig.json'));
    const { paths } = await analyze(project, { responseAnalyzer });
    return JSON.parse(JSON.stringify(paths));
  } finally {
    await rm(links, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
}

describe('analyze() reads the source of a referenced workspace package', () => {
  const library = `
export class HTTPException extends Error {
  constructor(public status: number, options?: { message: string }) {
    super(options?.message);
  }
}
export function ensureRun(found: boolean): void {
  if (!found) {
    throw new HTTPException(404, { message: 'Run not found' });
  }
}
function streamText(options: { prompt: string }) {
  return { prompt: options.prompt };
}
export async function summarizeRun(id: string) {
  return streamText({ prompt: id });
}
export async function toSql(input: string) {
  return streamText({ prompt: input });
}
`;

  test('a package helper the handler awaits for a value adds no text/plain response', async () => {
    const paths = await analyzeWithReference(
      `${routing}
import { toSql } from '@ws/runs';
app.post('/sql-agent', validate(() => ({})), async (c: Ctx) => {
  const result = await toSql('list runs');
  return c.json({ output: String(result) });
});
`,
      library,
    );

    assert.deepStrictEqual(contentTypes(paths['/sql-agent'].post.responses), {
      '200': ['application/json'],
    });
  });

  test('a throw in a package helper is documented when the workspace is opened through a symlink', async () => {
    const paths = await analyzeWithReference(
      `${routing}
import { ensureRun } from '@ws/runs';
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  ensureRun(flag());
  return c.json({ deleted: true });
});
`,
      library,
      'symlink',
    );

    assert.deepStrictEqual(contentTypes(paths['/runs/{id}'].delete.responses), {
      '200': ['application/json'],
      '404': ['application/json'],
    });
  });

  test('a throw in a package helper the handler calls is documented', async () => {
    const paths = await analyzeWithReference(
      `${routing}
import { ensureRun } from '@ws/runs';
app.delete('/runs/:id', validate(() => ({})), (c: Ctx) => {
  ensureRun(flag());
  return c.json({ deleted: true });
});
`,
      library,
    );

    assert.deepStrictEqual(contentTypes(paths['/runs/{id}'].delete.responses), {
      '200': ['application/json'],
      '404': ['application/json'],
    });
  });

  test('a returned package helper call documents its text/plain response', async () => {
    const paths = await analyzeWithReference(
      `${routing}
import { summarizeRun } from '@ws/runs';
app.post('/runs/:id/summary', validate(() => ({})), async (c: Ctx) => {
  return await summarizeRun('x');
});
`,
      library,
    );

    assert.deepStrictEqual(
      contentTypes(paths['/runs/{id}/summary'].post.responses),
      { '200': ['text/plain'] },
    );
  });
});
