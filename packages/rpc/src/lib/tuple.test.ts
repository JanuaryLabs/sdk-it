import { TemporaryFiles } from '@zukhruf/fs';
import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rpc, toAgents } from '@sdk-it/rpc';
import { parseErrorFor } from '@sdk-it/testing';

// A JSON Schema 2020-12 tuple, written by hand the way an OpenAPI 3.1
// document gives one: prefixItems, with items for what follows them.
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
            schema:
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
      responses:
        '204': { description: Paired }
  /uploads:
    post:
      operationId: upload
      tags: [pairs]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [named]
              properties:
                named:
                  type: array
                  prefixItems:
                    - { type: string }
                    - { type: string, format: binary, contentEncoding: binary }
                  items: false
                  minItems: 2
      responses:
        '204': { description: Uploaded }
`;

const valid = {
  pair: ['a', 1],
  closed: ['a'],
  head: ['a', 1, 2],
  open: [],
  named: [{ name: 'n' }],
};

void test.each(
  [
    valid,
    { ...valid, closed: [] },
    { ...valid, head: ['a'] },
    { ...valid, open: ['a'] },
    { ...valid, open: ['a', 5, { any: true }] },
  ],
  (accepted) =>
    test(`rpc validates a prefixItems tuple as its schema allows: accepts ${JSON.stringify(accepted)}`, async () => {
      // Arrange
      await using directory = await new TemporaryFiles().directory(
        'rpc-tuple-',
      );
      const file = join(directory.path, 'openapi.yaml');
      await writeFile(file, document);
      const client = await rpc(file, {
        fetch: async () => new Response(null, { status: 204 }),
      });

      // Act and assert
      await assert.doesNotReject(client.request('POST /pairs', accepted));
    }),
);

void test.each(
  [
    ['pair', ['a']],
    ['pair', ['a', 1, 2]],
    ['pair', [1, 'a']],
    ['closed', ['a', 1]],
    ['head', []],
    ['head', ['a', 'b']],
    ['open', [5]],
    ['open', ['a', 'b']],
    ['named', [{}]],
  ] as const,
  ([field, wrong]) =>
    test(`rpc validates a prefixItems tuple as its schema allows: refuses ${field} ${JSON.stringify(wrong)}`, async () => {
      // Arrange
      await using directory = await new TemporaryFiles().directory(
        'rpc-tuple-',
      );
      const file = join(directory.path, 'openapi.yaml');
      await writeFile(file, document);
      const client = await rpc(file, {
        fetch: async () => new Response(null, { status: 204 }),
      });

      // Act and assert
      await assert.rejects(
        client.request('POST /pairs', { ...valid, [field]: wrong }),
        parseErrorFor(field),
        `${field}: ${JSON.stringify(wrong)}`,
      );
    }),
);

void test('rpc agents get no tool for an input whose tuple holds a file', async () => {
  // Arrange
  await using directory = await new TemporaryFiles().directory(
    'rpc-tuple-tools-',
  );
  const file = join(directory.path, 'openapi.yaml');
  await writeFile(file, document);

  // Act
  const agents = await toAgents(file, {
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });

  // Assert
  assert.deepEqual(Object.keys(agents.pairs.tools), ['pair']);
});
