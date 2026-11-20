import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { runNode, workspaceDirectory } from '@sdk-it/testing';

const storeDocument = (server: string, schema: string) => `openapi: 3.1.0
info: { title: Store, version: 1.0.0 }
servers: [{ url: ${server} }]
paths:
  /pets/{petId}:
    get:
      operationId: getPet
      parameters:
        - { name: petId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema: { $ref: '${schema}' }
`;

const main = (document: string) => `import { store } from './${document}';

const pet = await store.request('GET /pets/{petId}', { petId: 'p1' });
console.log(JSON.stringify(pet));
`;

function petServer() {
  return new HttpServer().start((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ name: 'Rex', path: request.url }));
  });
}

function runWithLoader(file: string) {
  return runNode(['--import', '@sdk-it/content-mapper/register', file]);
}

test('node with the register loader runs the SDK of an imported OpenAPI document and exits', async () => {
  await using pets = await petServer();
  await using app = await workspaceDirectory('register-');
  await writeFile(join(app.path, 'pet.yaml'), 'type: object\n');
  await writeFile(
    join(app.path, 'store.openapi.yaml'),
    storeDocument(pets.origin, './pet.yaml'),
  );
  await writeFile(join(app.path, 'main.ts'), main('store.openapi.yaml'));

  const { exitCode, stdout, stderr } = await runWithLoader(
    join(app.path, 'main.ts'),
  );

  assert.equal(exitCode, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { name: 'Rex', path: '/pets/p1' });
});

test('a document whose $ref does not resolve fails the import at the $ref', async () => {
  await using app = await workspaceDirectory('register-');
  await writeFile(
    join(app.path, 'store.openapi.yaml'),
    storeDocument('https://store.test', './missing.yaml'),
  );
  await writeFile(join(app.path, 'main.ts'), main('store.openapi.yaml'));

  const { exitCode, stderr } = await runWithLoader(join(app.path, 'main.ts'));

  assert.notEqual(exitCode, 0);
  assert.match(
    stderr,
    /store\.openapi\.yaml:15:31: Could not resolve \$ref \.\/missing\.yaml/,
  );
});

test('a JSON document imported with the .openapi extension runs its SDK', async () => {
  await using pets = await petServer();
  await using app = await workspaceDirectory('register-');
  await writeFile(
    join(app.path, 'store.openapi'),
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Store', version: '1.0.0' },
      servers: [{ url: pets.origin }],
      paths: {
        '/pets/{petId}': {
          get: {
            operationId: 'getPet',
            parameters: [
              {
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'A pet',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }),
  );
  await writeFile(join(app.path, 'main.ts'), main('store.openapi'));

  const { exitCode, stdout, stderr } = await runWithLoader(
    join(app.path, 'main.ts'),
  );

  assert.equal(exitCode, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { name: 'Rex', path: '/pets/p1' });
});
