import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type {
  ParameterObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { type TunedOperationObject, loadSpec, toIR } from '@sdk-it/spec';

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

test('a response schema in another file is hoisted into components', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
    const response = (ir.paths['/pets/{id}']?.get as TunedOperationObject)
      .responses['200'];

    assert.deepEqual(response.content['application/json'].schema, {
      $ref: '#/components/schemas/pet',
    });
    const pet = ir.components.schemas['pet'] as SchemaObject;
    assert.equal((pet.properties?.['id'] as SchemaObject).type, 'string');
    assert.deepEqual(pet.required, ['id']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a reference inside an external file resolves against that file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
    const pet = ir.components.schemas['pet'] as SchemaObject;

    assert.deepEqual(pet.properties?.['owner'], {
      $ref: '#/components/schemas/Owner',
    });
    assert.deepEqual(pet.properties?.['tag'], {
      $ref: '#/components/schemas/Tag',
    });
    const owner = ir.components.schemas['Owner'] as SchemaObject;
    assert.equal((owner.properties?.['name'] as SchemaObject).type, 'string');
    assert.deepEqual((ir.components.schemas['Tag'] as SchemaObject).enum, [
      'cat',
      'dog',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('one external schema referenced from two operations becomes one component', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
      Object.keys(ir.components.schemas).filter((name) =>
        name.startsWith('pet'),
      ),
      ['pet'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a cycle across external files terminates with local references', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
      const [schemas] = (await once(worker, 'message', {
        signal: AbortSignal.timeout(10_000),
      })) as [Record<string, SchemaObject>];

      assert.deepEqual(schemas['node'].properties?.['parent'], {
        $ref: '#/components/schemas/edge',
      });
      assert.deepEqual(schemas['edge'].properties?.['node'], {
        $ref: '#/components/schemas/node',
      });
    } finally {
      await worker.terminate();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('external parameters and responses are hoisted into their sections and an external path item is inlined', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
    const listPets = ir.paths['/pets']?.get as TunedOperationObject;

    assert.equal(
      (ir.components.parameters?.['limit'] as ParameterObject).name,
      'limit',
    );
    assert.equal(
      (ir.components.responses?.['NotFound'] as ResponseObject).description,
      'Not found',
    );
    assert.ok(
      listPets.parameters.some(
        (parameter) => 'name' in parameter && parameter.name === 'limit',
      ),
      JSON.stringify(listPets.parameters),
    );
    assert.equal(listPets.responses['404'].description, 'Not found');
    assert.equal(
      (ir.paths['/health']?.get as TunedOperationObject).operationId,
      'getHealth',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an external file that points back into the root document keeps a local reference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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

    assert.deepEqual(
      (ir.components.schemas['wrapper'] as SchemaObject).properties?.['shared'],
      { $ref: '#/components/schemas/Shared' },
    );
    assert.deepEqual(
      Object.keys(ir.components.schemas).filter((name) =>
        name.startsWith('Shared'),
      ),
      ['Shared'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing external file rejects with a message naming the reference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    /Could not resolve \$ref \.\/pet\.yaml .*no \$self/,
  );
});

test('loadSpec lists every document the spec was read from, entry first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadSpec returns a spec with no references to other files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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

    const response = spec.paths?.['/pets']?.get?.responses?.[
      '200'
    ] as ResponseObject;
    assert.deepEqual(response.content?.['application/json'].schema, {
      $ref: '#/components/schemas/pet',
    });
    const pet = spec.components?.schemas?.['pet'] as SchemaObject;
    assert.deepEqual(pet.properties?.['owner'], {
      $ref: '#/components/schemas/Owner',
    });
    assert.ok(spec.components?.schemas?.['Owner']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadSpec lists the document a security scheme URI points to', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-it-external-refs-'));
  try {
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
