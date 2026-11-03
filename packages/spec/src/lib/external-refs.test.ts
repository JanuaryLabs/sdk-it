import { TemporaryFiles } from '@zukhruf/testing/fs';
import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { isRef } from '@sdk-it/core';
import { loadSpec, toIR } from '@sdk-it/spec';

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

test('a response schema in another file is hoisted into components', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets/{id}:
    get:
      operationId: getPet
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema: { $ref: './schemas/pet.yaml' }
`,
    'schemas/pet.yaml': `
type: object
properties:
  id: { type: string }
required: [id]
`,
  });

  const ir = await toIR({
    spec: (await loadSpec(join(dir, 'openapi.yaml'))).spec,
  });
  const response = ir.paths['/pets/{id}']?.get?.responses?.['200'];
  assert.ok(response);

  assert.deepEqual(response.content?.['application/json'].schema, {
    $ref: '#/components/schemas/pet',
  });
  const pet = ir.components.schemas['pet'];
  assert.ok(!isRef(pet));
  const id = pet.properties?.['id'];
  assert.ok(id && !isRef(id));
  assert.equal(id.type, 'string');
  assert.deepEqual(pet.required, ['id']);
});

test('a reference inside an external file resolves against that file', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './schemas/pet.yaml' }
`,
    'schemas/pet.yaml': `
type: object
properties:
  owner: { $ref: './owner.yaml#/Owner' }
  tag: { $ref: '#/$defs/Tag' }
$defs:
  Tag: { type: string, enum: [cat, dog] }
`,
    'schemas/owner.yaml': `
Owner:
  type: object
  properties:
    name: { type: string }
`,
  });

  const ir = await toIR({
    spec: (await loadSpec(join(dir, 'openapi.yaml'))).spec,
  });
  const pet = ir.components.schemas['pet'];
  assert.ok(!isRef(pet));

  assert.deepEqual(pet.properties?.['owner'], {
    $ref: '#/components/schemas/Owner',
  });
  assert.deepEqual(pet.properties?.['tag'], {
    $ref: '#/components/schemas/Tag',
  });
  const owner = ir.components.schemas['Owner'];
  assert.ok(!isRef(owner));
  const name = owner.properties?.['name'];
  assert.ok(name && !isRef(name));
  assert.equal(name.type, 'string');
  const tag = ir.components.schemas['Tag'];
  assert.ok(!isRef(tag));
  assert.deepEqual(tag.enum, ['cat', 'dog']);
});

test('one external schema referenced from two operations becomes one component', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './pet.yaml' }
  /pets/{id}:
    get:
      operationId: getPet
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: Pet
          content:
            application/json:
              schema: { $ref: './pet.yaml' }
`,
    'pet.yaml': `
type: object
properties:
  id: { type: string }
`,
  });

  const ir = await toIR({
    spec: (await loadSpec(join(dir, 'openapi.yaml'))).spec,
  });

  assert.deepEqual(
    Object.keys(ir.components.schemas).filter((name) => name.startsWith('pet')),
    ['pet'],
  );
});

test('a cycle across external files terminates with local references', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Tree, version: 1.0.0 }
paths:
  /nodes:
    get:
      operationId: listNodes
      responses:
        '200':
          description: Nodes
          content:
            application/json:
              schema: { $ref: './node.yaml' }
`,
    'node.yaml': `
type: object
properties:
  parent: { $ref: './edge.yaml' }
`,
    'edge.yaml': `
type: object
properties:
  node: { $ref: './node.yaml' }
`,
  });

  // A cycle that never terminates starves the event loop with resolved
  // promises, so no in-process timeout can fire; bundle in a worker instead.
  const worker = new Worker(
    `(async () => {
        const { parentPort, workerData } = await import('node:worker_threads');
        const { loadSpec, toIR } = await import('@sdk-it/spec');
        const ir = await toIR({ spec: (await loadSpec(workerData)).spec });
        parentPort.postMessage(ir.components.schemas);
      })();`,
    { eval: true, workerData: join(dir, 'openapi.yaml') },
  );
  try {
    const [schemas]: Record<string, SchemaObject>[] = await once(
      worker,
      'message',
      { signal: AbortSignal.timeout(10_000) },
    );

    assert.deepEqual(schemas['node'].properties?.['parent'], {
      $ref: '#/components/schemas/edge',
    });
    assert.deepEqual(schemas['edge'].properties?.['node'], {
      $ref: '#/components/schemas/node',
    });
  } finally {
    await worker.terminate();
  }
});

test('external parameters and responses are hoisted into their sections and an external path item is inlined', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      parameters:
        - $ref: './shared.yaml#/parameters/limit'
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { type: array, items: { type: string } }
        '404':
          $ref: './shared.yaml#/responses/NotFound'
  /health:
    $ref: './health.yaml'
`,
    'shared.yaml': `
parameters:
  limit:
    name: limit
    in: query
    schema: { type: integer }
responses:
  NotFound:
    description: Not found
    content:
      application/json:
        schema: { type: object, properties: { message: { type: string } } }
`,
    'health.yaml': `
get:
  operationId: getHealth
  responses:
    '204': { description: Healthy }
`,
  });

  const ir = await toIR({
    spec: (await loadSpec(join(dir, 'openapi.yaml'))).spec,
  });
  const listPets = ir.paths['/pets']?.get;
  assert.ok(listPets);

  const limit = ir.components.parameters?.['limit'];
  assert.ok(limit && !isRef(limit));
  assert.equal(limit.name, 'limit');
  const notFound = ir.components.responses?.['NotFound'];
  assert.ok(notFound && !isRef(notFound));
  assert.equal(notFound.description, 'Not found');
  assert.ok(
    listPets.parameters?.some(
      (parameter) => 'name' in parameter && parameter.name === 'limit',
    ),
    JSON.stringify(listPets.parameters),
  );
  assert.equal(listPets.responses?.['404'].description, 'Not found');
  assert.equal(ir.paths['/health']?.get?.operationId, 'getHealth');
});

test('an external file that points back into the root document keeps a local reference', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
components:
  schemas:
    Shared:
      type: object
      properties:
        id: { type: string }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './schemas/wrapper.yaml' }
`,
    'schemas/wrapper.yaml': `
type: object
properties:
  shared: { $ref: '../openapi.yaml#/components/schemas/Shared' }
`,
  });

  const ir = await toIR({
    spec: (await loadSpec(join(dir, 'openapi.yaml'))).spec,
  });

  const wrapper = ir.components.schemas['wrapper'];
  assert.ok(!isRef(wrapper));
  assert.deepEqual(wrapper.properties?.['shared'], {
    $ref: '#/components/schemas/Shared',
  });
  assert.deepEqual(
    Object.keys(ir.components.schemas).filter((name) =>
      name.startsWith('Shared'),
    ),
    ['Shared'],
  );
});

test('a missing external file rejects with a message naming the reference', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './missing.yaml' }
`,
  });

  await assert.rejects(
    loadSpec(join(dir, 'openapi.yaml')),
    /Could not resolve \$ref \.\/missing\.yaml/,
  );
});

test('a relative external reference in a spec without $self rejects with a clear message', async () => {
  const schema: ReferenceObject = { $ref: './pet.yaml' };

  await assert.rejects(
    toIR({
      spec: {
        openapi: '3.1.0',
        info: { title: 'Pets', version: '1.0.0' },
        paths: {
          '/pets': {
            get: {
              operationId: 'listPets',
              responses: {
                '200': {
                  description: 'Pets',
                  content: { 'application/json': { schema } },
                },
              },
            },
          },
        },
      },
    }),
    /Could not resolve \$ref \.\/pet\.yaml: the document declares no \$self/,
  );
});

test('loadSpec lists every document the spec was read from, entry first', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './schemas/pet.yaml' }
`,
    'schemas/pet.yaml': `
type: object
properties:
  owner: { $ref: './owner.yaml#/Owner' }
`,
    'schemas/owner.yaml': `
Owner: { type: object, properties: { name: { type: string } } }
`,
  });

  const { documents } = await loadSpec(join(dir, 'openapi.yaml'));

  assert.deepEqual(documents, [
    pathToFileURL(join(dir, 'openapi.yaml')).href,
    pathToFileURL(join(dir, 'schemas/pet.yaml')).href,
    pathToFileURL(join(dir, 'schemas/owner.yaml')).href,
  ]);
});

test('loadSpec returns a spec with no references to other files', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './schemas/pet.yaml' }
`,
    'schemas/pet.yaml': `
type: object
properties:
  owner: { $ref: './owner.yaml#/Owner' }
`,
    'schemas/owner.yaml': `
Owner: { type: object, properties: { name: { type: string } } }
`,
  });

  const { spec } = await loadSpec(join(dir, 'openapi.yaml'));

  const response = spec.paths?.['/pets']?.get?.responses?.['200'];
  assert.ok(response);
  assert.deepEqual(response.content?.['application/json'].schema, {
    $ref: '#/components/schemas/pet',
  });
  const pet = spec.components?.schemas?.['pet'];
  assert.ok(pet && !isRef(pet));
  assert.deepEqual(pet.properties?.['owner'], {
    $ref: '#/components/schemas/Owner',
  });
  assert.ok(spec.components?.schemas?.['Owner']);
});

test('loadSpec lists the document a security scheme URI points to', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-external-refs-',
  );
  const dir = workspace.path;
  await writeFiles(dir, {
    'openapi.yaml': `
openapi: 3.2.0
info: { title: Records, version: 1.0.0 }
paths:
  /records:
    get:
      operationId: getRecords
      security:
        - './auth.yaml#/components/securitySchemes/key': []
      responses:
        '204': { description: OK }
`,
    'auth.yaml': `
components:
  securitySchemes:
    key: { type: apiKey, in: header, name: X-Key }
`,
  });

  const { spec, documents } = await loadSpec(join(dir, 'openapi.yaml'));

  assert.deepEqual(documents, [
    pathToFileURL(join(dir, 'openapi.yaml')).href,
    pathToFileURL(join(dir, 'auth.yaml')).href,
  ]);
  assert.deepEqual(spec.components?.securitySchemes, {
    key: { type: 'apiKey', in: 'header', name: 'X-Key' },
  });
  assert.deepEqual(spec.paths?.['/records']?.get?.security, [{ key: [] }]);
});

test('a document used by a $ref and a security scheme URI is fetched once across loadSpec and toIR', async () => {
  const requested: (string | undefined)[] = [];
  await using server = await new HttpServer().start((request, response) => {
    requested.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify(
        request.url === '/openapi.json'
          ? {
              openapi: '3.2.0',
              info: { title: 'Pets', version: '1.0.0' },
              paths: {
                '/pets': {
                  get: {
                    operationId: 'listPets',
                    security: [
                      { './shared.json#/components/securitySchemes/key': [] },
                    ],
                    responses: {
                      '200': {
                        description: 'Pets',
                        content: {
                          'application/json': {
                            schema: { $ref: './shared.json#/Pet' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            }
          : {
              Pet: { type: 'object', properties: { id: { type: 'string' } } },
              components: {
                securitySchemes: {
                  key: { type: 'apiKey', in: 'header', name: 'X-Key' },
                },
              },
            },
      ),
    );
  });

  const { spec } = await loadSpec(`${server.origin}/openapi.json`);
  const ir = await toIR({ spec });

  assert.deepEqual(requested, ['/openapi.json', '/shared.json']);
  assert.ok(ir.components.schemas['Pet']);
  assert.ok(ir.components.securitySchemes['key']);
});
