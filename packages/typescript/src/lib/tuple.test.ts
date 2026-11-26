import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadSpec } from '@sdk-it/spec';
import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// JSON Schema 2020-12 tuples, written by hand the way an OpenAPI 3.1
// document gives them: prefixItems, with items for what follows them. The
// body is both the request and the response, so the input and the output
// types are each checked.
const document = `
openapi: 3.1.0
info: { title: Pairs, version: 1.0.0 }
servers: [{ url: 'https://api.test' }]
paths:
  /pairs:
    post:
      operationId: pair
      tags: [pairs]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Body' }
      responses:
        '200':
          description: Paired
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Body' }
components:
  schemas:
    Body:
      type: object
      required: [pair, closed, head, open, named]
      properties:
        pair:
          type: array
          prefixItems: [{ type: string }, { type: number }]
          items: false
          minItems: 2
          maxItems: 2
        closed:
          type: array
          prefixItems: [{ type: string }]
          items: false
        head:
          type: array
          prefixItems: [{ type: string }]
          items: { type: number }
          minItems: 1
        open:
          type: array
          prefixItems: [{ type: string }, { type: number }]
        named:
          type: array
          prefixItems:
            - properties: { name: { type: string } }
              required: [name]
          minItems: 1
          maxItems: 1
`;

const valid = {
  pair: ['a', 1],
  closed: ['a'],
  head: ['a', 1, 2],
  open: [],
  named: [{ name: 'n' }],
};

async function generated(prefix: string) {
  const workspace = await workspaceDirectory(prefix);
  const file = join(workspace.path, 'openapi.yaml');
  await writeFile(file, document);
  await generate((await loadSpec(file)).spec, {
    output: workspace.path,
    name: 'Pairs',
    packageName: '@acme/pairs',
    readme: false,
    mode: 'full',
  });
  return workspace;
}

void test('a prefixItems tuple accepts the arrays its schema allows and refuses the rest', async () => {
  // Arrange
  await using workspace = await generated('tuple-runtime-');
  const { createPairs } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createPairs({
    baseUrl: 'https://api.test',
    fetch: async () => Response.json(valid),
  });

  // Act and assert
  for (const accepted of [
    valid,
    { ...valid, closed: [] },
    { ...valid, head: ['a'] },
    { ...valid, open: ['a'] },
    { ...valid, open: ['a', 5, { any: true }] },
  ]) {
    await assert.doesNotReject(client.request('POST /pairs', accepted));
  }
  for (const [field, wrong] of [
    ['pair', ['a']],
    ['pair', ['a', 1, 2]],
    ['pair', [1, 'a']],
    ['closed', ['a', 1]],
    ['head', []],
    ['head', ['a', 'b']],
    ['open', [5]],
    ['open', ['a', 'b']],
    ['named', [{}]],
  ] as const) {
    await assert.rejects(
      client.request('POST /pairs', { ...valid, [field]: wrong }),
      parseErrorFor(field),
      `${field}: ${JSON.stringify(wrong)}`,
    );
  }
});

void test('a prefixItems tuple is typed by its elements and what follows them, in the input and the output', async () => {
  // Arrange
  await using workspace = await generated('tuple-type-');
  const consumer = join(workspace.path, 'src', 'consumer.ts');
  const lines = (side: 'input' | 'output') =>
    [
      `type ${side}Body = PairsEndpoints['POST /pairs']['${side}'];`,
      "const pair: Body['pair'] = ['a', 1];",
      '// @ts-expect-error a pair has two elements',
      "const short: Body['pair'] = ['a'];",
      '// @ts-expect-error a pair holds no third element',
      "const long: Body['pair'] = ['a', 1, 2];",
      "const closed: Body['closed'] = [];",
      '// @ts-expect-error items: false closes the tuple',
      "const overClosed: Body['closed'] = ['a', 1];",
      "const head: Body['head'] = ['a', 1, 2];",
      '// @ts-expect-error the rest are numbers',
      "const badRest: Body['head'] = ['a', 'b'];",
      "const open: Body['open'] = [];",
      "const openOne: Body['open'] = ['a'];",
      "const openMore: Body['open'] = ['a', 5, null];",
      '// @ts-expect-error the second element is a number',
      "const badOpen: Body['open'] = ['a', 'b'];",
      "const named: Body['named'] = [{ name: 'n' }];",
      '// @ts-expect-error the element requires name',
      "const unnamed: Body['named'] = [{}];",
    ].map((line) =>
      line
        .replace(/^const (\w+)/, `export const ${side}_$1`)
        .replace("Body['", `${side}Body['`),
    );
  await writeFile(
    consumer,
    [
      "import type { PairsEndpoints } from './index.ts';",
      ...lines('input'),
      ...lines('output'),
      '',
    ].join('\n'),
  );

  // Act
  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  // Assert
  assert.ok(files.includes(consumer));
  assert.deepEqual(diagnostics, []);
});
