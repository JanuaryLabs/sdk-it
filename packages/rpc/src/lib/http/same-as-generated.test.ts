import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { format } from 'prettier';

import { render } from '@sdk-it/typescript';

// rpc keeps a copy of the http layer that every generated SDK carries
// (backlog #2984). Delete this test when @sdk-it/runtime replaces both copies.

// No security schemes: a generated SDK then has no http/security.ts, which rpc
// does not copy.
const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Notes', version: '1.0.0' },
  paths: {
    '/notes': {
      get: {
        operationId: 'listNotes',
        tags: ['notes'],
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
};

async function generatedHttpLayer() {
  const files = await render(spec, {
    name: 'Notes',
    style: { name: 'github' },
    useTsExtension: true,
  });
  return new Map(
    Object.entries(files)
      .filter(([path]) => path.startsWith('http/') && path !== 'http/index.ts')
      .map(([path, source]) => [path.slice('http/'.length), source]),
  );
}

async function ownHttpLayer() {
  const names = (await readdir(import.meta.dirname)).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  return new Map(
    await Promise.all(
      names.map(
        async (name) =>
          [
            name,
            await readFile(join(import.meta.dirname, name), 'utf8'),
          ] as const,
      ),
    ),
  );
}

async function codeWithoutImports(source: string) {
  const formatted = await format(source, {
    parser: 'typescript',
    singleQuote: true,
  });
  return formatted.replace(/^import\s[^;]*;\n/gm, '').trim();
}

void test("rpc's http layer has the same modules as a generated SDK's", async () => {
  const generated = await generatedHttpLayer();
  const own = await ownHttpLayer();

  assert.deepEqual([...own.keys()].sort(), [...generated.keys()].sort());
});

void test("each rpc http module has the same code as the generated SDK's", async () => {
  const generated = await generatedHttpLayer();
  const own = await ownHttpLayer();

  for (const [name, source] of own) {
    assert.equal(
      await codeWithoutImports(source),
      await codeWithoutImports(generated.get(name) ?? ''),
      `http/${name} differs between rpc and the generated SDK`,
    );
  }
});
