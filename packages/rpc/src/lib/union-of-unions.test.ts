import { TemporaryFiles } from '@zukhruf/fs';
import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rpc } from '@sdk-it/rpc';
import { parseErrorFor } from '@sdk-it/testing';

// Each union's only branch besides null has no type that can say "or null":
// a union of either kind, or a const (#5136).
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
            schema:
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
      responses:
        '204': { description: Set }
components:
  schemas:
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

void test.each(
  [
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
  ],
  (body) =>
    test(`rpc validates a union whose only branch is a union by that union: accepts ${JSON.stringify(body)}`, async () => {
      // Arrange
      await using directory = await new TemporaryFiles().directory(
        'rpc-unions-',
      );
      const file = join(directory.path, 'openapi.yaml');
      await writeFile(file, document);
      const client = await rpc(file, {
        fetch: async () => new Response(null, { status: 204 }),
      });

      // Act and assert
      await assert.doesNotReject(
        client.request('POST /flags', body),
        JSON.stringify(body),
      );
    }),
);

void test.each(
  [
    ['maybe', 1],
    ['exclusive', 1],
    ['mixed', 1],
    ['toggle', 'off'],
    ['either', 1],
    ['either', null],
    ['pet', 1],
    ['name', 1],
  ] as const,
  ([field, wrong]) =>
    test(`rpc validates a union whose only branch is a union by that union: refuses ${field} ${JSON.stringify(wrong)}`, async () => {
      // Arrange
      await using directory = await new TemporaryFiles().directory(
        'rpc-unions-',
      );
      const file = join(directory.path, 'openapi.yaml');
      await writeFile(file, document);
      const client = await rpc(file, {
        fetch: async () => new Response(null, { status: 204 }),
      });

      // Act and assert
      await assert.rejects(
        client.request('POST /flags', { ...valid, [field]: wrong }),
        parseErrorFor(field),
        `${field}: ${JSON.stringify(wrong)}`,
      );
    }),
);
