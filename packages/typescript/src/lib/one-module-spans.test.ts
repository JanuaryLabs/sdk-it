import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { renderModule } from '@sdk-it/typescript';

function storeSpec(servers: string[]): OpenAPIObject {
  const json = (schema: SchemaObject | ReferenceObject) => ({
    'application/json': { schema },
  });
  return {
    openapi: '3.1.0',
    info: { title: 'Pet Store', version: '1.0.0' },
    servers: servers.map((url) => ({ url })),
    components: {
      schemas: {
        Pet: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        Ok: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string' } },
        },
      },
      responses: {
        Gone: {
          description: 'Gone',
          content: json({
            type: 'object',
            required: ['since'],
            properties: { since: { type: 'string' } },
          }),
        },
      },
    },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          tags: ['pets'],
          responses: {
            '200': {
              description: 'OK',
              content: json({
                type: 'object',
                required: ['data'],
                properties: {
                  data: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Pet' },
                  },
                },
              }),
            },
            default: {
              description: 'Error',
              content: json({
                type: 'object',
                required: ['message'],
                properties: { message: { type: 'string' } },
              }),
            },
          },
        },
        post: {
          operationId: 'createPet',
          tags: ['pets'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
              },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: json({ $ref: '#/components/schemas/Pet' }),
            },
            '409': {
              description: 'Conflict',
              content: json({ $ref: '#/components/schemas/Ok' }),
            },
          },
        },
      },
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          tags: ['pets'],
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
              description: 'OK',
              content: json({ $ref: '#/components/schemas/Pet' }),
            },
            '404': {
              description: 'Not Found',
              content: json({
                type: 'object',
                required: ['reason'],
                properties: { reason: { type: 'string' } },
              }),
            },
            '410': { $ref: '#/components/responses/Gone' },
          },
        },
      },
      '/reports': {
        get: {
          operationId: 'getReport',
          tags: ['pets'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['total'],
                    properties: { total: { type: 'integer' } },
                  },
                },
                'text/csv': { schema: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };
}

/** The value `location` names in `document`, walking its reference tokens. */
function valueAt(document: unknown, location: readonly string[]) {
  let value = document;
  for (const token of location) {
    assert.ok(
      typeof value === 'object' && value !== null && token in value,
      `${JSON.stringify(location)} is not in the document`,
    );
    value = Reflect.get(value, token);
  }
  return value;
}

void test('the span table maps each endpoint key to its operation, each model to its schema or inline body, and create<Name> and the default instance to info.title', async () => {
  const response = (
    path: string,
    method: string,
    status: string,
    type: string,
  ) => ['paths', path, method, 'responses', status, 'content', type, 'schema'];

  const byValue = (a: unknown, b: unknown) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;

  const { text, spans } = await renderModule(storeSpec(['https://pets.test']), {
    name: 'Pets',
  });

  assert.deepEqual(
    spans
      .map(({ start, end, location }) => [text.slice(start, end), location])
      .sort(byValue),
    [
      ['"GET /pets"', ['paths', '/pets', 'get']],
      ['"GET /pets/{petId}"', ['paths', '/pets/{petId}', 'get']],
      ['"GET /reports"', ['paths', '/reports', 'get']],
      ['"POST /pets"', ['paths', '/pets', 'post']],
      ['"formdata POST /pets"', ['paths', '/pets', 'post']],
      [
        'GetPet404',
        response('/pets/{petId}', 'get', '404', 'application/json'),
      ],
      [
        'GetPet410',
        [
          'components',
          'responses',
          'Gone',
          'content',
          'application/json',
          'schema',
        ],
      ],
      ['GetReport', response('/reports', 'get', '200', 'application/json')],
      ['GetReportOutput', response('/reports', 'get', '200', 'text/csv')],
      ['ListPets', response('/pets', 'get', '200', 'application/json')],
      [
        'ListPetsdefault',
        response('/pets', 'get', 'default', 'application/json'),
      ],
      ['Ok_', ['components', 'schemas', 'Ok']],
      ['Pet', ['components', 'schemas', 'Pet']],
      ['createPets', ['info', 'title']],
      ['pets', ['info', 'title']],
    ].sort(byValue),
  );
});

void test('every span covers the declared name or key as written, in order and apart, and its location names what it declares in the document the caller passed: an operation, a schema or the title', async () => {
  const spec = storeSpec(['https://pets.test']);

  const { text, spans } = await renderModule(structuredClone(spec), {
    name: 'Pets',
  });

  assert.ok(spans.length > 0);
  for (const [index, { start, end, location }] of spans.entries()) {
    const name = text.slice(start, end);
    const value = valueAt(spec, location);
    assert.ok(start < end, JSON.stringify(location));
    assert.ok(index === 0 || spans[index - 1].end <= start, 'sorted, apart');
    assert.match(name, /^(?:"[^"]+"|[A-Za-z_$][\w$]*)$/);
    if (location.join('/') === 'info/title') {
      assert.equal(value, 'Pet Store', name);
    } else if (name.startsWith('"')) {
      assert.ok(isObject(value) && 'responses' in value, name);
    } else {
      assert.ok(isObject(value) && 'type' in value, name);
    }
  }
});

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

void test('a spec with two servers has no default instance, so only create<Name> maps to info.title', async () => {
  const { text, spans } = await renderModule(
    storeSpec(['https://a.pets.test', 'https://b.pets.test']),
    { name: 'Pets' },
  );

  assert.deepEqual(
    spans
      .filter(({ location }) => location.join('/') === 'info/title')
      .map(({ start, end }) => text.slice(start, end)),
    ['createPets'],
  );
});

void test('a span follows a referenced response to where its body is, and a name the document cannot back gets no span: a synthetic success model, a rewritten path key', async () => {
  const json = (schema: SchemaObject | ReferenceObject) => ({
    'application/json': { schema },
  });
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Tracker', version: '1.0.0' },
    servers: [{ url: 'https://tracker.test' }],
    components: {
      responses: {
        Missing: {
          description: 'Missing',
          content: json({
            type: 'object',
            required: ['reason'],
            properties: { reason: { type: 'string' } },
          }),
        },
      },
    },
    paths: {
      '/items/{id}': {
        get: {
          operationId: 'getItem',
          tags: ['items'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: json({
                type: 'object',
                required: ['id'],
                properties: { id: { type: 'string' } },
              }),
            },
            '404': { $ref: '#/components/responses/Missing' },
          },
        },
      },
      '/legacy/:code': {
        get: {
          operationId: 'getLegacy',
          tags: ['items'],
          parameters: [
            {
              name: 'code',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: json({
                type: 'object',
                properties: { code: { type: 'string' } },
              }),
            },
          },
        },
      },
      '/pings': {
        post: {
          operationId: 'sendPing',
          tags: ['items'],
          responses: { '302': { description: 'Found' } },
        },
      },
    },
  };
  const byValue = (a: unknown, b: unknown) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;

  const { text, spans } = await renderModule(spec, { name: 'Tracker' });

  assert.deepEqual(
    spans
      .map(({ start, end, location }) => [text.slice(start, end), location])
      .sort(byValue),
    [
      ['"GET /items/{id}"', ['paths', '/items/{id}', 'get']],
      ['"POST /pings"', ['paths', '/pings', 'post']],
      [
        'GetItem',
        [
          'paths',
          '/items/{id}',
          'get',
          'responses',
          '200',
          'content',
          'application/json',
          'schema',
        ],
      ],
      [
        'GetItem404',
        [
          'components',
          'responses',
          'Missing',
          'content',
          'application/json',
          'schema',
        ],
      ],
      ['createTracker', ['info', 'title']],
      ['tracker', ['info', 'title']],
    ].sort(byValue),
  );
});
