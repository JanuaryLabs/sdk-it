import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadSpec } from '@sdk-it/spec';
import { workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

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

void test('a generated client sends null to a union with a null branch as null, even when another branch coerces', async () => {
  // Arrange
  await using workspace = await workspaceDirectory('nullable-union-order-');
  const file = join(workspace.path, 'openapi.yaml');
  await writeFile(file, document);
  await generate((await loadSpec(file)).spec, {
    output: workspace.path,
    name: 'Flags',
    packageName: '@acme/flags',
    readme: false,
    mode: 'full',
  });
  const { createFlags } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createFlags({
    baseUrl: 'https://api.test',
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
  assert.deepEqual(sentNull, { either: null, exclusive: null, listed: null });
  assert.deepEqual(sentText, { either: 'x', exclusive: 'x', listed: 'x' });
});
