import { TemporaryFiles } from '@zukhruf/fs';
import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rpc } from '@sdk-it/rpc';

// JSON Schema's unions have no order, but zod's union returns the first
// branch that succeeds, and a coerce-string branch turns null into 'null'
// (#5142).
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
        '200':
          description: Echo
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Flag' }
components:
  schemas:
    Flag:
      type: object
      required: [either, exclusive, listed]
      properties:
        either:
          anyOf:
            - anyOf:
                - { type: string, x-zod-type: coerce-string }
                - { type: boolean, x-zod-type: coerce-boolean }
            - type: 'null'
        exclusive:
          oneOf:
            - anyOf:
                - { type: string, x-zod-type: coerce-string }
                - { type: boolean, x-zod-type: coerce-boolean }
            - type: 'null'
        listed:
          type: [string, boolean, 'null']
          x-zod-type: coerce-string
`;

void test('rpc sends null to a union with a null branch as null, even when another branch coerces', async () => {
  // Arrange
  await using directory = await new TemporaryFiles().directory(
    'rpc-nullable-union-order-',
  );
  const file = join(directory.path, 'openapi.yaml');
  await writeFile(file, document);
  const client = await rpc(file, {
    fetch: async (request: Request) => Response.json(await request.json()),
  });

  // Act
  const sentNull = await client.request('POST /flags', {
    either: null,
    exclusive: null,
    listed: null,
  });
  const sentText = await client.request('POST /flags', {
    either: 'x',
    exclusive: 'x',
    listed: 'x',
  });

  // Assert
  assert.deepEqual(sentNull.data, {
    either: null,
    exclusive: null,
    listed: null,
  });
  assert.deepEqual(sentText.data, { either: 'x', exclusive: 'x', listed: 'x' });
});
