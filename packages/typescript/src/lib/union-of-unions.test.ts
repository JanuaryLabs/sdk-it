import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadSpec } from '@sdk-it/spec';
import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// A union whose one non-null branch is itself a union, as JSON Schema
// writes string | boolean | null when the inner union is not flattened
// (zod does not flatten branches that carry their own keywords, #5136).
const document = `
openapi: 3.1.0
info: { title: Flags, version: 1.0.0 }
servers: [{ url: 'https://api.test' }]
paths:
  /flags:
    post:
      operationId: setFlag
      tags: [flags]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Flag' }
      responses:
        '204': { description: Set }
components:
  schemas:
    Flag:
      type: object
      required: [maybe, exclusive, mixed, toggle, either, pet, name]
      properties:
        pet:
          anyOf:
            - $ref: '#/components/schemas/Pet'
            - type: 'null'
        name:
          anyOf:
            - type: string
            - type: 'null'
        maybe:
          anyOf:
            - anyOf: [{ type: string }, { type: boolean }]
            - type: 'null'
        exclusive:
          oneOf:
            - oneOf: [{ type: string }, { type: boolean }]
            - type: 'null'
        mixed:
          anyOf:
            - oneOf: [{ type: string }, { type: boolean }]
            - type: 'null'
        toggle:
          anyOf:
            - const: 'on'
            - type: 'null'
        either:
          anyOf:
            - anyOf: [{ type: string }, { type: boolean }]
    Pet:
      type: object
      required: [name]
      properties:
        name: { type: string }
`;

const valid = {
  maybe: 'x',
  exclusive: 'x',
  mixed: 'x',
  toggle: 'on',
  either: 'x',
  pet: { name: 'n' },
  name: 'n',
};

async function generated(prefix: string) {
  const workspace = await workspaceDirectory(prefix);
  const file = join(workspace.path, 'openapi.yaml');
  await writeFile(file, document);
  await generate((await loadSpec(file)).spec, {
    output: workspace.path,
    name: 'Flags',
    packageName: '@acme/flags',
    readme: false,
    mode: 'full',
  });
  return workspace;
}

void test('a generated client validates a union whose only branch is a union by that union', async () => {
  // Arrange
  await using workspace = await generated('union-of-unions-runtime-');
  const { createFlags } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createFlags({
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });

  // Act and assert
  for (const body of [
    valid,
    { ...valid, maybe: true, exclusive: false, mixed: true, either: false },
    {
      ...valid,
      maybe: null,
      exclusive: null,
      mixed: null,
      toggle: null,
      pet: null,
      name: null,
    },
  ]) {
    await assert.doesNotReject(
      client.request('POST /flags', body),
      JSON.stringify(body),
    );
  }
  for (const [field, wrong] of [
    ['maybe', 1],
    ['exclusive', 1],
    ['mixed', 1],
    ['toggle', 'off'],
    ['either', 1],
    ['either', null],
    ['pet', 1],
    ['name', 1],
  ] as const) {
    await assert.rejects(
      client.request('POST /flags', { ...valid, [field]: wrong }),
      parseErrorFor(field),
      `${field}: ${JSON.stringify(wrong)}`,
    );
  }
});

void test('a generated client types a union whose only branch is a union by that union', async () => {
  // Arrange
  await using workspace = await generated('union-of-unions-type-');
  const consumer = join(workspace.path, 'src', 'consumer.ts');
  await writeFile(
    consumer,
    [
      "import type { FlagsEndpoints } from './index.ts';",
      "type Input = FlagsEndpoints['POST /flags']['input'];",
      "const maybe: Input['maybe'][] = ['x', true, null];",
      '// @ts-expect-error maybe is a string, a boolean or null',
      "const maybeNumber: Input['maybe'] = 1;",
      "const exclusive: Input['exclusive'][] = ['x', true, null];",
      '// @ts-expect-error exclusive is a string, a boolean or null',
      "const exclusiveNumber: Input['exclusive'] = 1;",
      "const toggle: Input['toggle'][] = ['on', null];",
      '// @ts-expect-error toggle is on or null',
      "const toggleOff: Input['toggle'] = 'off';",
      "const pet: Input['pet'][] = [{ name: 'n' }, null];",
      "const name: Input['name'][] = ['n', null];",
      '// @ts-expect-error name is a string or null',
      "const nameNumber: Input['name'] = 1;",
      "const either: Input['either'][] = ['x', true];",
      '// @ts-expect-error either is a string or a boolean',
      "const eitherNumber: Input['either'] = 1;",
      '// @ts-expect-error either is never null',
      "const eitherNull: Input['either'] = null;",
      'export { maybe, maybeNumber, exclusive, exclusiveNumber, toggle, toggleOff, pet, name, nameNumber, either, eitherNumber, eitherNull };',
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
