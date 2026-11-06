import { API } from '@typescript/native/sync';
import { TemporaryFiles } from '@zukhruf/testing/fs';
import { describe, test } from '@zukhruf/testing/node';
import { build as esbuild } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { loadSpec } from '@sdk-it/spec';
import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

function figmaShapedSpec(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Figma-shaped API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    security: [{ oauth2: [] }, { personalToken: [] }, { planToken: [] }],
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
              scopes: {},
            },
          },
        },
        // Two distinct schemes resolving to the SAME header, as in Figma's
        // real spec (PersonalAccessToken + PlanAccessToken → X-Figma-Token).
        personalToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Figma-Token',
        },
        planToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Figma-Token',
        },
      },
    },
    paths: {
      '/me': {
        get: {
          operationId: 'getMe',
          security: [{ personalToken: [] }, { planToken: [] }],
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/files': {
        get: {
          operationId: 'getFiles',
          security: [{ oauth2: [] }, { personalToken: [] }, { planToken: [] }],
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    },
  };
}

function dictionaryRequestSpec(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Dictionaries', version: '1.0.0' },
    paths: {
      '/settings': {
        post: {
          operationId: 'updateSettings',
          tags: ['settings'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    skills: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean' },
                        },
                        required: ['enabled'],
                        additionalProperties: false,
                      },
                    },
                    labels: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                    },
                    profile: {
                      type: 'object',
                      properties: {
                        enabled: { type: 'boolean' },
                      },
                      required: ['enabled'],
                      additionalProperties: false,
                    },
                  },
                  required: ['skills', 'labels', 'profile'],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            '204': { description: 'Updated' },
          },
        },
      },
    },
  };
}

function agentToolSpec(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Agent tools', version: '1.0.0' },
    tags: [
      {
        name: 'users',
        'x-name': 'Users',
        'x-instructions': 'Manage users',
      },
    ],
    paths: {
      '/users': {
        get: {
          operationId: 'list-users',
          tags: ['users'],
          description: 'List users',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('generate — dictionary inputs', () => {
  test('preserves dictionary value schemas through tuning and Zod generation', async () => {
    await using directory = await workspaceDirectory('generate-dictionary-');
    await generate(dictionaryRequestSpec(), {
      output: directory.path,
      name: 'Dictionaries',
      readme: false,
    });

    const bundlePath = join(directory.path, 'settings-schema.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'inputs', 'settings.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const generated: {
      updateSettingsSchema: {
        safeParse(value: unknown): { success: boolean };
      };
    } = createRequire(import.meta.url)(bundlePath);

    assert.equal(
      generated.updateSettingsSchema.safeParse({
        skills: {
          calendar: { enabled: true },
          search: { enabled: false },
        },
        labels: { source: 'manual' },
        profile: { enabled: true },
      }).success,
      true,
      'arbitrary dictionary keys should accept object values',
    );
    assert.equal(
      generated.updateSettingsSchema.safeParse({
        skills: { search: {} },
        labels: { source: 'manual' },
        profile: { enabled: true },
      }).success,
      false,
      'each object dictionary value should require enabled',
    );
    assert.equal(
      generated.updateSettingsSchema.safeParse({
        skills: { search: { enabled: true } },
        labels: { source: 1 },
        profile: { enabled: true },
      }).success,
      false,
      'primitive dictionary values should keep their value schema',
    );
    assert.equal(
      generated.updateSettingsSchema.safeParse({
        skills: { search: { enabled: true } },
        labels: { source: 'manual' },
        profile: { named: { enabled: true } },
      }).success,
      false,
      'an ordinary object should not become a dictionary',
    );
  });
});

test('generated input validators keep required type unions required', async () => {
  await using directory = await workspaceDirectory('generate-required-union-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Union inputs', version: '1.0.0' },
      paths: {
        '/values': {
          post: {
            operationId: 'createValue',
            tags: ['values'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      requiredValue: { type: ['string', 'integer'] },
                      optionalValue: { type: ['string', 'integer'] },
                    },
                    required: ['requiredValue'],
                  },
                },
              },
            },
            responses: { '204': { description: 'Created' } },
          },
        },
      },
    },
    { output: directory.path, name: 'Values', readme: false },
  );
  const bundlePath = join(directory.path, 'values-schema.cjs');
  await esbuild({
    entryPoints: [join(directory.path, 'inputs', 'values.ts')],
    bundle: true,
    outfile: bundlePath,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const {
    createValueSchema,
  }: {
    createValueSchema: {
      safeParse(value: unknown): { success: boolean };
    };
  } = createRequire(import.meta.url)(bundlePath);

  for (const [input, expected] of [
    [{ requiredValue: 'hello' }, true],
    [{ requiredValue: 7, optionalValue: 'hello' }, true],
    [{ requiredValue: 'hello', optionalValue: 7 }, true],
    [{ requiredValue: 7, optionalValue: undefined }, true],
    [{}, false],
    [{ requiredValue: undefined }, false],
    [{ requiredValue: null }, false],
    [{ requiredValue: false }, false],
    [{ requiredValue: 1.5 }, false],
    [{ requiredValue: 7, optionalValue: false }, false],
  ] as const) {
    assert.equal(
      createValueSchema.safeParse(input).success,
      expected,
      `validation of ${JSON.stringify(input)}`,
    );
  }
});

test('generated nullable anyOf contracts preserve null separately from omission', async () => {
  await using directory = await workspaceDirectory(
    'generate-nullable-contract-',
  );
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Nullable values', version: '1.0.0' },
      paths: {
        '/values': {
          post: {
            operationId: 'createValue',
            tags: ['values'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Value' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Value',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Value' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Value: {
            type: 'object',
            properties: {
              price: {
                anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
              },
              optionalPrice: {
                anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
              },
            },
            required: ['price'],
          },
        },
      },
    },
    { output: directory.path, name: 'Values', readme: false, mode: 'full' },
  );
  const configPath = join(directory.path, 'tsconfig.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  writeFileSync(configPath, JSON.stringify(config));
  const bundlePath = join(directory.path, 'values-schema.cjs');
  await esbuild({
    entryPoints: [join(directory.path, 'src', 'inputs', 'values.ts')],
    bundle: true,
    outfile: bundlePath,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const {
    createValueSchema,
  }: {
    createValueSchema: { safeParse(value: unknown): { success: boolean } };
  } = createRequire(import.meta.url)(bundlePath);
  for (const [input, expected] of [
    [{ price: null }, true],
    [{ price: 0, optionalPrice: null }, true],
    [{ price: 5, optionalPrice: 3 }, true],
    [{ price: null, optionalPrice: undefined }, true],
    [{}, false],
    [{ price: undefined }, false],
    [{ price: '5' }, false],
    [{ price: null, optionalPrice: 'bad' }, false],
  ] as const) {
    assert.equal(
      createValueSchema.safeParse(input).success,
      expected,
      `validation of ${JSON.stringify(input)}`,
    );
  }
  writeFileSync(
    join(directory.path, 'src', 'consumer.ts'),
    `
import { Values } from './index.ts';
const client = new Values({ baseUrl: 'https://example.test' });
const read = () => client.request('POST /values', { price: null });
// @ts-expect-error A required request price cannot be omitted.
client.request('POST /values', {});
// @ts-expect-error A required request price cannot be undefined.
client.request('POST /values', { price: undefined });
type Value = Awaited<ReturnType<typeof read>>;
const nullPrice: Value['price'] = null;
const numberPrice: Value['price'] = 2;
const optionalNull: Value['optionalPrice'] = null;
const optionalOmitted: Value['optionalPrice'] = undefined;
// @ts-expect-error A required nullable value is not optional.
const missing: Value['price'] = undefined;
// @ts-expect-error Strings are not prices.
const stringPrice: Value['price'] = '2';
void [nullPrice, numberPrice, optionalNull, optionalOmitted, missing, stringPrice];
`,
  );
  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});

test('a spec split across files generates a client typed by the referenced models', async () => {
  await using specDir = await new TemporaryFiles().directory(
    'generate-multi-file-spec-',
  );
  await using directory = await workspaceDirectory('generate-multi-file-');
  mkdirSync(join(specDir.path, 'schemas'));
  writeFileSync(
    join(specDir.path, 'openapi.yaml'),
    `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets/{id}:
    get:
      operationId: getPet
      tags: [pets]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema: { $ref: './schemas/pet.yaml' }
`,
  );
  writeFileSync(
    join(specDir.path, 'schemas', 'pet.yaml'),
    `
type: object
properties:
  id: { type: string }
  owner: { $ref: './owner.yaml#/Owner' }
required: [id, owner]
`,
  );
  writeFileSync(
    join(specDir.path, 'schemas', 'owner.yaml'),
    `
Owner:
  type: object
  properties:
    name: { type: string }
  required: [name]
`,
  );

  await generate((await loadSpec(join(specDir.path, 'openapi.yaml'))).spec, {
    output: directory.path,
    name: 'Pets',
    readme: false,
    mode: 'full',
  });
  writeFileSync(
    join(directory.path, 'src', 'consumer.ts'),
    `
import { Pets } from './index.ts';
const client = new Pets({ baseUrl: 'https://example.test' });
const read = () => client.request('GET /pets/{id}', { id: 'a' });
type Pet = Awaited<ReturnType<typeof read>>;
const pet: Pet = { id: 'a', owner: { name: 'Ada' } };
// @ts-expect-error The owner model from owner.yaml requires a name.
const nameless: Pet = { id: 'a', owner: {} };
void [pet, nameless];
`,
  );
  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});

test('allOf parts keep their required properties in generated types and input validators', async () => {
  await using directory = await workspaceDirectory('generate-all-of-required-');
  const space: SchemaObject = {
    allOf: [
      {
        type: 'object',
        properties: { _count: { type: 'number' } },
        required: ['_count'],
      },
      {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    ],
  };
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Spaces', version: '1.0.0' },
      paths: {
        '/spaces': {
          get: {
            operationId: 'listSpaces',
            tags: ['spaces'],
            responses: {
              '200': {
                description: 'Spaces',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: space },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'createSpace',
            tags: ['spaces'],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: space } },
            },
            responses: { '204': { description: 'Created' } },
          },
        },
      },
    },
    { output: directory.path, name: 'Spaces', readme: false, mode: 'full' },
  );
  const bundlePath = join(directory.path, 'spaces-schema.cjs');
  await esbuild({
    entryPoints: [join(directory.path, 'src', 'inputs', 'spaces.ts')],
    bundle: true,
    outfile: bundlePath,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const {
    createSpaceSchema,
  }: {
    createSpaceSchema: { safeParse(value: unknown): { success: boolean } };
  } = createRequire(import.meta.url)(bundlePath);
  for (const [input, expected] of [
    [{ _count: 1, id: 'a', name: 'b' }, true],
    [{ id: 'a', name: 'b' }, false],
    [{ _count: 1, id: 'a' }, false],
  ] as const) {
    assert.equal(
      createSpaceSchema.safeParse(input).success,
      expected,
      `validation of ${JSON.stringify(input)}`,
    );
  }
  writeFileSync(
    join(directory.path, 'src', 'consumer.ts'),
    `
import { Spaces } from './index.ts';
const client = new Spaces({ baseUrl: 'https://example.test' });
const read = () => client.request('GET /spaces', {});
type Space = Awaited<ReturnType<typeof read>>[number];
const complete: Space = { _count: 1, id: 'a', name: 'b' };
// @ts-expect-error _count comes from the first allOf part and is required.
const missingCount: Space = { id: 'a', name: 'b' };
// @ts-expect-error name comes from the last allOf part and is required.
const missingName: Space = { _count: 1, id: 'a' };
void [complete, missingCount, missingName];
`,
  );
  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});

describe('generate — discriminated input unions', () => {
  test('client.prepare accepts objects matching one discriminator branch', async () => {
    await using directory = await workspaceDirectory(
      'generate-discriminated-input-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Messages', version: '1.0.0' },
        paths: {
          '/messages': {
            post: {
              operationId: 'createMessage',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        messages: {
                          type: 'array',
                          items: {
                            oneOf: [
                              {
                                $ref: '#/components/schemas/SystemMessage',
                              },
                              { $ref: '#/components/schemas/UserMessage' },
                            ],
                            discriminator: { propertyName: 'role' },
                          },
                        },
                      },
                      required: ['messages'],
                    },
                  },
                },
              },
              responses: { '204': { description: 'Created' } },
            },
          },
        },
        components: {
          schemas: Object.fromEntries(
            ['system', 'user'].map((role) => [
              `${role[0].toUpperCase()}${role.slice(1)}Message`,
              {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: [role] },
                  content: { type: 'string' },
                },
                required: ['role', 'content'],
              },
            ]),
          ),
        },
      },
      { output: directory.path, name: 'Messages', readme: false },
    );

    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      Messages,
    }: {
      Messages: new (options: { baseUrl: string }) => {
        prepare(endpoint: string, input: unknown): Promise<unknown>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new Messages({ baseUrl: 'https://api.example.com' });

    for (const role of ['system', 'user']) {
      await client.prepare('POST /messages', {
        messages: [{ role, content: 'hello' }],
      });
    }
  });
});

describe('generate — http runtime', () => {
  test('marks the SSE reader pump as intentionally unawaited', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-sse-void-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Events', version: '1.0.0' },
        paths: {
          '/events': {
            get: {
              operationId: 'streamEvents',
              tags: ['events'],
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'text/event-stream': {
                      schema: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        output: directory.path,
        name: 'Events',
        readme: false,
      },
    );

    const source = readFileSync(join(directory.path, 'http', 'sse.ts'), 'utf8');
    // Consumers lint generated output with no-floating-promises; a bare
    // async IIFE trips it even though the pump catches internally.
    assert.match(source, /^\s*void \(async \(\) => \{/m);
  });

  test('a declared error status rejects with its APIError subclass, an Error with a stack and a readable message', async () => {
    await using directory = await workspaceDirectory('generate-api-error-');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
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
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { id: { type: 'string' } },
                      },
                    },
                  },
                },
                '404': {
                  description: 'Not found',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { message: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { output: directory.path, name: 'Items', readme: false, mode: 'minimal' },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    type HttpError = Error & {
      status: number;
      headers: Headers;
      data: unknown;
    };
    const generated: {
      Items: new (options: unknown) => {
        request(endpoint: string, input: unknown): Promise<unknown>;
      };
      APIError: new (...args: never[]) => HttpError;
      NotFound: new (...args: never[]) => HttpError;
    } = createRequire(import.meta.url)(bundlePath);
    const client = new generated.Items({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        Response.json({ message: 'Item not found' }, { status: 404 }),
    });

    await assert.rejects(
      client.request('GET /items/{id}', { id: '7' }),
      (error) => {
        assert.ok(error instanceof generated.NotFound);
        assert.equal(error instanceof generated.APIError, true);
        assert.equal(error instanceof Error, true, 'an HTTP error is an Error');
        assert.equal(error.status, 404);
        assert.equal(error.headers.get('content-type'), 'application/json');
        assert.deepStrictEqual(error.data, { message: 'Item not found' });
        assert.equal(
          error.message,
          'Request failed with status code 404: {"message":"Item not found"}',
        );
        assert.ok(error.stack);
        assert.match(
          error.stack,
          /^APIError: Request failed with status code 404/,
        );
        return true;
      },
    );
  });

  test('an undeclared error status with an HTML page rejects with an APIError whose message stays one short line', async () => {
    await using directory = await workspaceDirectory(
      'generate-api-error-html-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              tags: ['items'],
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { output: directory.path, name: 'Items', readme: false, mode: 'minimal' },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const generated: {
      Items: new (options: unknown) => {
        request(endpoint: string, input: unknown): Promise<unknown>;
      };
      APIError: new (...args: never[]) => Error & {
        status: number;
        data: unknown;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const page = `<!DOCTYPE html>\n<html>\n  <body>\n    <h1>503 Service Unavailable</h1>\n${'    <p>The upstream did not answer in time.</p>\n'.repeat(60)}  </body>\n</html>\n`;
    const client = new generated.Items({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response(page, {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        }),
    });

    await assert.rejects(client.request('GET /items', {}), (error) => {
      assert.ok(error instanceof generated.APIError);
      assert.equal(error instanceof Error, true, 'an HTTP error is an Error');
      assert.equal(error.constructor, generated.APIError);
      assert.equal(error.status, 503);
      assert.equal(error.data, page);
      assert.equal(typeof error.stack, 'string');
      assert.equal(
        error.message,
        'Request failed with status code 503: <!DOCTYPE html> <html> <body> <h1>503 Service Unavailable</h1> <p>The upstream did not answer in time.</p> <p>The upstream did not answer in time.</p> <p>The upstream did not answer in time.</p> <p>Th…',
      );
      return true;
    });
  });

  test('an error with a binary body names only its status in the message', async () => {
    await using directory = await workspaceDirectory(
      'generate-api-error-binary-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              tags: ['items'],
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { output: directory.path, name: 'Items', readme: false, mode: 'minimal' },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const generated: {
      Items: new (options: unknown) => {
        request(endpoint: string, input: unknown): Promise<unknown>;
      };
      APIError: new (...args: never[]) => Error & { data: unknown };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new generated.Items({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]), {
          status: 500,
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    });

    await assert.rejects(client.request('GET /items', {}), (error) => {
      assert.ok(error instanceof generated.APIError);
      assert.equal(error instanceof Error, true, 'an HTTP error is an Error');
      assert.equal(error.data instanceof Blob, true);
      assert.equal(error.message, 'Request failed with status code 500');
      return true;
    });
  });

  test('an error with a JSON array body summarizes the array in the message', async () => {
    await using directory = await workspaceDirectory(
      'generate-api-error-array-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
        paths: {
          '/items': {
            post: {
              operationId: 'createItem',
              tags: ['items'],
              responses: { '201': { description: 'Created' } },
            },
          },
        },
      },
      { output: directory.path, name: 'Items', readme: false, mode: 'minimal' },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const generated: {
      Items: new (options: unknown) => {
        request(endpoint: string, input: unknown): Promise<unknown>;
      };
      APIError: new (...args: never[]) => Error;
    } = createRequire(import.meta.url)(bundlePath);
    const client = new generated.Items({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        Response.json([{ field: 'name', message: 'is required' }], {
          status: 422,
        }),
    });

    await assert.rejects(client.request('POST /items', {}), (error) => {
      assert.ok(error instanceof generated.APIError);
      assert.equal(
        error.message,
        'Request failed with status code 422: [{"field":"name","message":"is required"}]',
      );
      return true;
    });
  });

  test('an SSE stream error reaches the caller after the events received before it', async () => {
    await using directory = await workspaceDirectory('generate-sse-error-');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Events', version: '1.0.0' },
        paths: {
          '/events': {
            get: {
              operationId: 'streamEvents',
              tags: ['events'],
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'text/event-stream': { schema: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      {
        output: directory.path,
        name: 'Events',
        readme: false,
        mode: 'minimal',
      },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const generated: {
      Events: new (options: unknown) => {
        request(
          endpoint: string,
          input: unknown,
        ): Promise<(eventType: string) => AsyncIterable<string>>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const connectionReset = new Error('connection reset');
    const streamErrored = Promise.withResolvers<void>();
    const client = new generated.Events({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: one\n\n'));
            },
            pull(controller) {
              controller.error(connectionReset);
              streamErrored.resolve();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    });

    const listen = await client.request('GET /events', {});
    const events = listen('message');
    // Start iterating only after the reader has seen the failure, so the
    // queued event and the error are both pending when the caller reads.
    await streamErrored.promise;
    await new Promise((resolve) => setImmediate(resolve));
    const received: string[] = [];
    await assert.rejects(
      async () => {
        for await (const data of events) {
          received.push(data);
        }
      },
      (error) => {
        assert.equal(error, connectionReset);
        return true;
      },
    );
    assert.deepStrictEqual(received, ['one']);
  });
});

describe('generate — response bodies follow the spec body kind', () => {
  test('a success response that declares no content resolves to null and is typed null', async () => {
    await using directory = await workspaceDirectory('generate-bodyless-');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Things', version: '1.0.0' },
        paths: {
          '/things': {
            post: {
              operationId: 'createThing',
              tags: ['things'],
              responses: { '201': { description: 'Created' } },
            },
          },
        },
      },
      { output: directory.path, name: 'Things', readme: false, mode: 'full' },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'src', 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      Things,
    }: {
      Things: new (options: unknown) => {
        request(endpoint: string, input: unknown): Promise<unknown>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new Things({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response(null, {
          status: 201,
          headers: { 'Content-Length': '0' },
        }),
    });

    assert.equal(await client.request('POST /things', {}), null);
    writeFileSync(
      join(directory.path, 'src', 'consumer.ts'),
      `
import { Things } from './index.ts';
const client = new Things({ baseUrl: 'https://example.test' });
const create = () => client.request('POST /things', {});
const nothing: Awaited<ReturnType<typeof create>> = null;
// @ts-expect-error A response without content carries no data.
const something: Awaited<ReturnType<typeof create>> = {};
void [nothing, something];
`,
    );
    assert.deepEqual(
      typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
      [],
    );
  });

  test('server-sent events with a referenced schema are typed and parsed as a listener', async () => {
    await using directory = await workspaceDirectory('generate-ref-sse-');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Events', version: '1.0.0' },
        components: {
          schemas: {
            Event: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
        paths: {
          '/events': {
            get: {
              operationId: 'streamEvents',
              tags: ['events'],
              responses: {
                '200': {
                  description: 'Events',
                  content: {
                    'text/event-stream': {
                      schema: { $ref: '#/components/schemas/Event' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { output: directory.path, name: 'Events', readme: false, mode: 'full' },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'src', 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      Events,
    }: {
      Events: new (options: unknown) => {
        request(
          endpoint: string,
          input: unknown,
        ): Promise<(eventType: string) => AsyncIterable<string>>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new Events({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response('data: {"id":"a"}\n\ndata: {"id":"b"}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    });

    const listen = await client.request('GET /events', {});
    const received = await Array.fromAsync(listen('message'));
    assert.deepStrictEqual(received, ['{"id":"a"}', '{"id":"b"}']);
    writeFileSync(
      join(directory.path, 'src', 'consumer.ts'),
      `
import { Events } from './index.ts';
import type { SSEListener } from './http/sse.ts';
const client = new Events({ baseUrl: 'https://example.test' });
const read = () => client.request('GET /events', {});
type Data = Awaited<ReturnType<typeof read>>;
const listener: SSEListener = {} as Data;
// @ts-expect-error The data is a listener, not the event model.
const model: Data = { id: 'a' };
void [listener, model];
`,
    );
    assert.deepEqual(
      typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
      [],
    );
  });

  test('a response sent with Transfer-Encoding is typed and parsed as a stream, not as its model', async () => {
    await using directory = await workspaceDirectory('generate-chunked-');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Chunks', version: '1.0.0' },
        components: {
          schemas: {
            Chunk: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
        paths: {
          '/chunks': {
            get: {
              operationId: 'readChunks',
              tags: ['chunks'],
              responses: {
                '200': {
                  description: 'Chunks',
                  headers: {
                    'Transfer-Encoding': { schema: { type: 'string' } },
                  },
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Chunk' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { output: directory.path, name: 'Chunks', readme: false, mode: 'full' },
    );
    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'src', 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      Chunks,
    }: {
      Chunks: new (options: unknown) => {
        request(endpoint: string, input: unknown): Promise<unknown>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new Chunks({
      baseUrl: 'https://api.example.com',
      fetch: async () =>
        new Response('{"id":"a"}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const data = await client.request('GET /chunks', {});
    assert.ok(data instanceof ReadableStream);
    assert.equal(await new Response(data).text(), '{"id":"a"}');
    writeFileSync(
      join(directory.path, 'src', 'consumer.ts'),
      `
import { Chunks } from './index.ts';
const client = new Chunks({ baseUrl: 'https://example.test' });
const read = () => client.request('GET /chunks', {});
type Data = Awaited<ReturnType<typeof read>>;
const stream: Data = new ReadableStream();
// @ts-expect-error The data is a stream, not the JSON model.
const model: Data = { id: 'a' };
void [stream, model];
`,
    );
    assert.deepEqual(
      typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
      [],
    );
  });
});

describe('generate — impossible schemas', () => {
  test('emits never arrays for schemas that reject every item', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-never-response-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Impossible response', version: '1.0.0' },
        paths: {
          '/impossible': {
            get: {
              operationId: 'listImpossible',
              tags: ['impossible'],
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'array',
                        items: { not: {} },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        output: directory.path,
        name: 'Impossible',
        readme: false,
      },
    );

    const source = readFileSync(
      join(directory.path, 'outputs', 'list-impossible.ts'),
      'utf8',
    );
    assert.match(source, /export type ListImpossible = \(never\)\[\];/);
  });

  test('emits z.never for request schemas that reject every value', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-never-input-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Impossible input', version: '1.0.0' },
        paths: {
          '/impossible': {
            post: {
              operationId: 'createImpossible',
              tags: ['impossible'],
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        value: { not: {} },
                      },
                      required: ['value'],
                    },
                  },
                },
              },
              responses: {
                '204': { description: 'Created' },
              },
            },
          },
        },
      },
      {
        output: directory.path,
        name: 'Impossible',
        readme: false,
      },
    );

    const source = readFileSync(
      join(directory.path, 'inputs', 'impossible.ts'),
      'utf8',
    );
    assert.match(source, /'value': z\.never\(\)/);
  });
});

describe('generate — AI SDK 7 agent tools', () => {
  void test.each(['ai-sdk', 'openai-agents'] as const, (agentTools) =>
    test(`emits a type-correct project for ${agentTools}`, async () => {
      await using directory = await workspaceDirectory(
        'generate-agent-typecheck-',
      );
      await generate(agentToolSpec(), {
        output: directory.path,
        name: 'AgentTools',
        readme: false,
        agentTools,
        mode: 'full',
      });

      const diagnostics = typecheck(
        join(directory.path, 'tsconfig.json'),
      ).diagnostics;
      assert.deepStrictEqual(
        diagnostics,
        [],
        `${agentTools} generated ${diagnostics.length} diagnostics:\n${diagnostics
          .map(
            (diagnostic) =>
              `${diagnostic.file}:${diagnostic.line} ${diagnostic.message}`,
          )
          .join('\n')}`,
      );
    }),
  );

  test('reads the tool-specific context from execution options', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-ai-sdk-tools-',
    );
    await generate(agentToolSpec(), {
      output: directory.path,
      name: 'AgentTools',
      readme: false,
      agentTools: 'ai-sdk',
      mode: 'full',
    });

    const source = readFileSync(join(directory.path, 'src/agents.ts'), 'utf8');
    const packageJson: {
      dependencies: Record<string, string>;
    } = JSON.parse(readFileSync(join(directory.path, 'package.json'), 'utf8'));
    assert.match(source, /coerceContext\(options\.context\)/);
    assert.doesNotMatch(source, /experimental_context/);
    assert.equal(packageJson.dependencies.ai, '^7.0.29');
  });

  test('declares the current OpenAI Agents SDK for generated tools', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-openai-tools-',
    );
    await generate(agentToolSpec(), {
      output: directory.path,
      name: 'OpenAIAgentTools',
      readme: false,
      agentTools: 'openai-agents',
      mode: 'full',
    });

    const source = readFileSync(join(directory.path, 'src/agents.ts'), 'utf8');
    const packageJson: { dependencies: Record<string, string> } = JSON.parse(
      readFileSync(join(directory.path, 'package.json'), 'utf8'),
    );
    assert.match(source, /maybeContext\?\.context/);
    assert.equal(packageJson.dependencies['@openai/agents'], '^0.21.0');
  });
});

describe('generate — client initialization', () => {
  test('README omits a sole server URL but shows an explicit choice for multiple URLs', async () => {
    await using oneServer = await new TemporaryFiles().directory(
      'generate-one-server-readme-',
    );
    await using multipleServers = await new TemporaryFiles().directory(
      'generate-multiple-server-readme-',
    );
    const directories = [oneServer, multipleServers];
    const serverSets = [
      [{ url: 'https://api.example.com' }],
      [
        { url: 'https://api.example.com' },
        { url: 'https://staging.example.com' },
      ],
    ];
    const clientBlocks: Array<string | undefined> = [];

    for (const [index, servers] of serverSets.entries()) {
      await generate(
        {
          openapi: '3.1.0',
          info: { title: 'Demo', version: '1.0.0' },
          servers,
          paths: {},
        },
        {
          output: directories[index].path,
          name: 'Demo',
          readme: true,
        },
      );
      const readme = readFileSync(
        join(directories[index].path, 'README.md'),
        'utf8',
      );
      clientBlocks.push(
        readme.match(/const demo = new Demo\([\s\S]*?\);/)?.[0],
      );
    }

    assert.deepStrictEqual(
      clientBlocks.map((block) => ({
        found: block !== undefined,
        includesBaseUrl: block?.includes('baseUrl') ?? false,
      })),
      [
        { found: true, includesBaseUrl: false },
        { found: true, includesBaseUrl: true },
      ],
    );
  });
});

describe('generate — security options assembly', () => {
  test('rejects unresolved external security schemes instead of generating an unauthenticated client', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-external-security-',
    );
    await assert.rejects(
      generate(
        {
          openapi: '3.2.0',
          info: { title: 'External security', version: '1.0.0' },
          paths: {
            '/records': {
              get: {
                operationId: 'getRecords',
                security: [{ 'https://auth.example.com/security-scheme': [] }],
                responses: { '204': { description: 'OK' } },
              },
            },
          },
        },
        { output: directory.path, name: 'ExternalSecurity', readme: false },
      ),
      /Security scheme https:\/\/auth\.example\.com\/security-scheme must be resolved/,
    );
  });

  test('generates a client for a security scheme resolved from an external URI', async () => {
    await using directory = await workspaceDirectory(
      'generate-resolved-security-',
    );
    writeFileSync(
      join(directory.path, 'auth.json'),
      JSON.stringify({
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          },
        },
      }),
    );
    const output = join(directory.path, 'sdk');

    await generate(
      {
        openapi: '3.2.0',
        info: { title: 'Resolved security', version: '1.0.0' },
        $self: pathToFileURL(join(directory.path, 'openapi.json')).href,
        paths: {
          '/records': {
            get: {
              operationId: 'getRecords',
              security: [
                { './auth.json#/components/securitySchemes/apiKey': [] },
              ],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      { output, name: 'ResolvedSecurity', readme: false },
    );

    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(output, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      ResolvedSecurity,
    }: {
      ResolvedSecurity: new (options: unknown) => {
        prepare(
          endpoint: string,
          input: unknown,
        ): Promise<{ init: { headers: Headers } }>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new ResolvedSecurity({
      baseUrl: 'https://api.example.com',
      credentials: { apiKey: 'secret' },
    });

    const request = await client.prepare('GET /records', {});
    assert.equal(request.init.headers.get('X-API-Key'), 'secret');
  });

  test('emits a type-correct client for the complete security scheme surface', async () => {
    await using directory = await workspaceDirectory(
      'generate-security-typecheck-',
    );
    await generate(
      {
        openapi: '3.2.0',
        info: { title: 'Security types', version: '1.0.0' },
        components: {
          securitySchemes: {
            headerKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
            queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
            cookieKey: { type: 'apiKey', in: 'cookie', name: 'session' },
            bearer: { type: 'http', scheme: 'bearer' },
            basic: { type: 'http', scheme: 'basic' },
            digest: { type: 'http', scheme: 'digest' },
            oauth: {
              type: 'oauth2',
              oauth2MetadataUrl:
                'https://auth.example.com/.well-known/oauth-authorization-server',
              flows: {
                deviceAuthorization: {
                  deviceAuthorizationUrl: 'https://auth.example.com/device',
                  tokenUrl: 'https://auth.example.com/token',
                  scopes: { 'records:read': 'Read records' },
                },
              },
            },
            oidc: {
              type: 'openIdConnect',
              openIdConnectUrl:
                'https://auth.example.com/.well-known/openid-configuration',
            },
            mtls: { type: 'mutualTLS' },
          },
        },
        paths: {
          '/records': {
            get: {
              operationId: 'getRecords',
              security: [
                { headerKey: [], queryKey: [], cookieKey: [], mtls: [] },
                { bearer: ['doctor'] },
                { basic: [] },
                { digest: [] },
                { oauth: ['records:read'] },
                { oidc: ['openid'] },
              ],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      {
        output: directory.path,
        name: 'SecurityTypes',
        readme: false,
        mode: 'full',
      },
    );

    assert.deepStrictEqual(
      typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
      [],
    );
  });

  test('preserves each security alternative under its exact scheme name', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-security-',
    );
    await generate(figmaShapedSpec(), {
      output: directory.path,
      name: 'Figma',
      readme: false,
    });

    const clientSource = readFileSync(
      join(directory.path, 'client.ts'),
      'utf8',
    );
    const httpIndexSource = readFileSync(
      join(directory.path, 'http/index.ts'),
      'utf8',
    );
    const credentialsBlock = clientSource.slice(
      clientSource.indexOf('const credentialsSchema'),
      clientSource.indexOf('const optionsSchema'),
    );
    assert.deepStrictEqual(
      ['oauth2', 'personalToken', 'planToken'].map(
        (name) =>
          credentialsBlock.match(new RegExp(`"${name}":`, 'g'))?.length ?? 0,
      ),
      [1, 1, 1],
    );
    assert.match(clientSource, /from '.\/http\/security\.ts'/);
    assert.doesNotMatch(clientSource, /function applyCredential/);
    assert.doesNotMatch(httpIndexSource, /security/);
    assert.doesNotMatch(clientSource, /async defaultInputs/);
  });

  test('selects a satisfiable security alternative and suppresses credentials on public operations', async () => {
    await using directory = await workspaceDirectory(
      'generate-security-runtime-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Security runtime', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearer: { type: 'http', scheme: 'bearer' },
            basic: { type: 'http', scheme: 'basic' },
            apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          },
        },
        paths: {
          '/records': {
            get: {
              operationId: 'getRecords',
              security: [{ bearer: ['doctor'] }, { apiKey: [] }],
              responses: { '204': { description: 'OK' } },
            },
          },
          '/status': {
            get: {
              operationId: 'getStatus',
              security: [],
              responses: { '204': { description: 'OK' } },
            },
          },
          '/basic': {
            get: {
              operationId: 'getBasic',
              security: [{ basic: [] }],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      { output: directory.path, name: 'Security', readme: false },
    );

    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      Security,
    }: {
      Security: new (options: unknown) => {
        prepare(
          endpoint: string,
          input: unknown,
        ): Promise<{
          init: { headers: Headers };
        }>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new Security({
      baseUrl: 'https://api.example.com',
      credentials: {
        apiKey: 'secret',
        basic: { username: 'doctor', password: 'secret' },
      },
    });

    const secured = await client.prepare('GET /records', {});
    const publicRequest = await client.prepare('GET /status', {});
    const basicRequest = await client.prepare('GET /basic', {});

    assert.deepStrictEqual(
      [
        secured.init.headers.get('X-API-Key'),
        secured.init.headers.get('Authorization'),
        publicRequest.init.headers.get('X-API-Key'),
        publicRequest.init.headers.get('Authorization'),
        basicRequest.init.headers.get('Authorization'),
      ],
      ['secret', null, null, null, 'Basic ZG9jdG9yOnNlY3JldA=='],
    );
  });

  test('sends the registered Authorization prefix whatever case the scheme uses', async () => {
    await using directory = await workspaceDirectory('generate-http-scheme-');
    await generate(
      {
        openapi: '3.2.0',
        info: { title: 'Http scheme', version: '1.0.0' },
        components: {
          securitySchemes: {
            lower: { type: 'http', scheme: 'bearer' },
            titled: { type: 'http', scheme: 'Bearer' },
          },
        },
        paths: {
          '/lower': {
            get: {
              operationId: 'getLower',
              security: [{ lower: [] }],
              responses: { '204': { description: 'OK' } },
            },
          },
          '/titled': {
            get: {
              operationId: 'getTitled',
              security: [{ titled: [] }],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      { output: directory.path, name: 'HttpScheme', readme: false },
    );

    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      HttpScheme,
    }: {
      HttpScheme: new (options: unknown) => {
        prepare(
          endpoint: string,
          input: unknown,
        ): Promise<{ init: { headers: Headers } }>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new HttpScheme({
      baseUrl: 'https://api.example.com',
      credentials: { lower: 'token-a', titled: 'token-b' },
    });

    const lower = await client.prepare('GET /lower', {});
    const titled = await client.prepare('GET /titled', {});

    assert.deepStrictEqual(
      [
        lower.init.headers.get('Authorization'),
        titled.init.headers.get('Authorization'),
      ],
      ['Bearer token-a', 'Bearer token-b'],
    );
  });

  test('prefers configured authentication over anonymous access and passes OAuth scopes', async () => {
    await using directory = await workspaceDirectory(
      'generate-optional-security-',
    );
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Optional security', version: '1.0.0' },
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: {
                clientCredentials: {
                  tokenUrl: 'https://auth.example.com/token',
                  scopes: { 'records:read': 'Read records' },
                },
              },
            },
          },
        },
        paths: {
          '/records': {
            get: {
              operationId: 'getRecords',
              security: [{}, { oauth: ['records:read'] }],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      { output: directory.path, name: 'OptionalSecurity', readme: false },
    );

    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      OptionalSecurity,
    }: {
      OptionalSecurity: new (options: unknown) => {
        prepare(
          endpoint: string,
          input: unknown,
        ): Promise<{
          init: { headers: Headers };
        }>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const contexts: unknown[] = [];
    const client = new OptionalSecurity({
      baseUrl: 'https://api.example.com',
      credentials: {
        oauth: (context: unknown) => {
          contexts.push(context);
          return 'access-token';
        },
      },
    });

    const request = await client.prepare('GET /records', {});

    assert.deepStrictEqual(
      {
        authorization: request.init.headers.get('Authorization'),
        contexts,
      },
      {
        authorization: 'Bearer access-token',
        contexts: [
          {
            scheme: 'oauth',
            scopes: ['records:read'],
            roles: [],
          },
        ],
      },
    );
  });

  test('applies every scheme in an AND requirement across query, cookie, and mutual TLS', async () => {
    await using directory = await workspaceDirectory('generate-and-security-');
    await generate(
      {
        openapi: '3.2.0',
        info: { title: 'AND security', version: '1.0.0' },
        components: {
          securitySchemes: {
            queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
            cookieKey: { type: 'apiKey', in: 'cookie', name: 'session' },
            mtls: { type: 'mutualTLS' },
          },
        },
        paths: {
          '/records': {
            get: {
              operationId: 'getRecords',
              security: [{ queryKey: [], cookieKey: [], mtls: [] }],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      { output: directory.path, name: 'AndSecurity', readme: false },
    );

    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(directory.path, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      AndSecurity,
    }: {
      AndSecurity: new (options: unknown) => {
        prepare(
          endpoint: string,
          input: unknown,
        ): Promise<{
          url: URL;
          init: { headers: Headers };
        }>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const client = new AndSecurity({
      baseUrl: 'https://api.example.com',
      credentials: {
        queryKey: 'query-secret',
        cookieKey: 'cookie-secret',
        mtls: true,
      },
    });

    const request = await client.prepare('GET /records', {});
    assert.equal(request.url.searchParams.get('api_key'), 'query-secret');
    assert.equal(request.init.headers.get('Cookie'), 'session=cookie-secret');

    const incomplete = new AndSecurity({
      baseUrl: 'https://api.example.com',
      credentials: { queryKey: 'query-secret' },
    });
    await assert.rejects(
      incomplete.prepare('GET /records', {}),
      /queryKey \+ cookieKey \+ mtls/,
    );
  });

  test('types credential values and providers for each security scheme', async () => {
    await using directory = await workspaceDirectory(
      'generate-mtls-typecheck-',
    );
    await generate(
      {
        openapi: '3.2.0',
        info: { title: 'mTLS', version: '1.0.0' },
        components: {
          securitySchemes: {
            mtls: { type: 'mutualTLS' },
            bearer: { type: 'http', scheme: 'bearer' },
            basic: { type: 'http', scheme: 'basic' },
          },
        },
        paths: {
          '/records': {
            get: {
              operationId: 'getRecords',
              security: [{ mtls: [] }],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      {
        output: directory.path,
        name: 'MutualTls',
        readme: false,
        mode: 'full',
      },
    );
    writeFileSync(
      join(directory.path, 'src/invalid-mtls.ts'),
      `import { MutualTls } from './index.ts';
new MutualTls({ baseUrl: '', credentials: { mtls: false } });
new MutualTls({ baseUrl: '', credentials: { mtls: 'certificate' } });
new MutualTls({ baseUrl: '', credentials: { mtls: () => 'certificate' } });
new MutualTls({ baseUrl: '', credentials: { basic: 'user:password' } });
new MutualTls({ baseUrl: '', credentials: { basic: () => 'user:password' } });
`,
    );

    const diagnostics = typecheck(
      join(directory.path, 'tsconfig.json'),
    ).diagnostics;
    assert.deepStrictEqual(
      diagnostics.map(({ file, line }) => ({
        file: file ? relative(directory.path, file) : undefined,
        line,
      })),
      [2, 3, 4, 5, 6].map((line) => ({
        file: join('src', 'invalid-mtls.ts'),
        line,
      })),
      `unexpected diagnostics:\n${diagnostics
        .map(({ file, line, message }) => `${file}:${line} ${message}`)
        .join('\n')}`,
    );
  });
});

// z.instanceof(Blob|File|Request|Response) evaluates the class as a runtime
// value: ReferenceError where the global is missing (browsers without File,
// older Node, workers) and instanceof failures for cross-realm/polyfill
// values. Decided in e62c4e1, documented in docs/recipes/file-upload.md —
// emitted client code must use bare z.custom<T>() instead.
describe('generate — emitted code is cross-runtime portable', () => {
  function uploadSpec(): OpenAPIObject {
    return {
      openapi: '3.1.0',
      info: { title: 'Uploads', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/files': {
          post: {
            operationId: 'uploadFile',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      file: { type: 'string', format: 'binary' },
                      preview: { type: 'string', format: 'byte' },
                      attachment: {
                        type: 'string',
                        contentEncoding: 'binary',
                      },
                    },
                    required: ['file'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
            },
          },
        },
      },
    };
  }

  // Fast first-line signal: names the exact offending file.
  test('no emitted file references web/Node globals via z.instanceof', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-portable-',
    );
    await generate(uploadSpec(), {
      output: directory.path,
      name: 'Uploads',
      readme: false,
    });

    const offenders = readdirSync(directory.path, {
      recursive: true,
      encoding: 'utf8',
    })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        readFileSync(join(directory.path, file), 'utf8').includes(
          'z.instanceof(',
        ),
      );
    assert.deepEqual(
      offenders,
      [],
      'emitted client code must not reference runtime globals via z.instanceof',
    );
  });

  // Ground truth: execute the bundled SDK in a realm that actually lacks the
  // fetch-API globals, the way a worker or older Node would load it.
  test('generated SDK executes in a runtime without Blob/File/Request/Response', async () => {
    await using directory = await workspaceDirectory('generate-vm-');
    await generate(uploadSpec(), {
      output: directory.path,
      name: 'Uploads',
      readme: false,
    });

    const bundle = async () => {
      const outfile = join(directory.path, 'bundle.cjs');
      await esbuild({
        entryPoints: [join(directory.path, 'index.ts')],
        bundle: true,
        outfile,
        format: 'cjs',
        platform: 'node',
        logLevel: 'silent',
      });
      return readFileSync(outfile, 'utf8');
    };

    const evaluate = (code: string) => {
      const moduleShim: { exports: Record<string, unknown> } = {
        exports: {},
      };
      const context = createContext({
        module: moduleShim,
        exports: moduleShim.exports,
        require: createRequire(import.meta.url),
        console,
        process,
        // Text/URL primitives exist in every target runtime; the
        // fetch-API classes deliberately do not.
        TextEncoder,
        TextDecoder,
        URL,
        URLSearchParams,
      });
      for (const name of [
        'Blob',
        'File',
        'Request',
        'Response',
        'Headers',
        'FormData',
        'fetch',
      ]) {
        assert.equal(
          runInContext(`typeof ${name}`, context),
          'undefined',
          `sandbox must lack ${name}`,
        );
      }
      runInContext(code, context);
      return moduleShim.exports;
    };

    // Module scope of the real SDK — including zod schema construction
    // for the binary upload input — must evaluate without web globals.
    const sdk = evaluate(await bundle());
    assert.ok(sdk['Uploads'], 'client class exported from sandboxed realm');

    // Negative control: reintroduce the historical bug (e62c4e1) and
    // prove this harness catches it.
    const inputsPath = join(directory.path, 'inputs', 'files.ts');
    const original = readFileSync(inputsPath, 'utf8');
    assert.ok(
      original.includes('z.custom<Blob>()'),
      'binary emission must be present in the generated inputs',
    );
    writeFileSync(
      inputsPath,
      original.replaceAll('z.custom<Blob>()', 'z.instanceof(Blob)'),
    );
    const broken = await bundle();
    assert.throws(() => evaluate(broken), /Blob is not defined/);
  });
});

async function withBrowserGlobals<T>(run: () => Promise<T>): Promise<T> {
  Object.defineProperty(globalThis, 'document', {
    value: {},
    configurable: true,
  });
  try {
    return await run();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
}

describe('generate — transport-owned credentials', () => {
  test('true declares a credential the transport supplies and sends nothing', async () => {
    await using directory = await workspaceDirectory(
      'generate-transport-owned-',
    );
    const output = join(directory.path, 'sdk');
    await generate(
      {
        openapi: '3.2.0',
        info: { title: 'Transport owned', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearer: { type: 'http', scheme: 'bearer' },
            session: { type: 'apiKey', in: 'cookie', name: 'session' },
          },
        },
        paths: {
          '/records': {
            get: {
              operationId: 'getRecords',
              security: [{ bearer: [] }, { session: [] }],
              responses: { '204': { description: 'OK' } },
            },
          },
        },
      },
      { output, name: 'TransportOwned', readme: false },
    );

    const bundlePath = join(directory.path, 'client.cjs');
    await esbuild({
      entryPoints: [join(output, 'index.ts')],
      bundle: true,
      outfile: bundlePath,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    });
    const {
      TransportOwned,
    }: {
      TransportOwned: new (options: unknown) => {
        prepare(
          endpoint: string,
          input: unknown,
        ): Promise<{ init: { headers: Headers } }>;
      };
    } = createRequire(import.meta.url)(bundlePath);
    const baseUrl = 'https://api.example.com';

    const proxied = await new TransportOwned({
      baseUrl,
      credentials: { bearer: true },
    }).prepare('GET /records', {});
    assert.equal(proxied.init.headers.get('Authorization'), null);

    const browserSession = await withBrowserGlobals(() =>
      new TransportOwned({
        baseUrl,
        credentials: { session: true },
      }).prepare('GET /records', {}),
    );
    assert.equal(browserSession.init.headers.get('Cookie'), null);

    await withBrowserGlobals(() =>
      assert.rejects(
        new TransportOwned({
          baseUrl,
          credentials: { session: 'abc' },
        }).prepare('GET /records', {}),
        /browsers forbid setting the Cookie header/,
      ),
    );

    await assert.rejects(
      new TransportOwned({ baseUrl, credentials: {} }).prepare(
        'GET /records',
        {},
      ),
      /Missing credentials for security requirements: bearer or session/,
    );

    const explicit = await new TransportOwned({
      baseUrl,
      credentials: { bearer: 'token' },
    }).prepare('GET /records', {});
    assert.equal(explicit.init.headers.get('Authorization'), 'Bearer token');
  });
});

function specWithModels(names: string[]): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Shop', version: '1.0.0' },
    servers: [{ url: 'https://shop.example.com' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: Object.fromEntries(
        names.map((name) => [
          name,
          {
            type: 'object',
            required: ['kind'],
            properties: { kind: { type: 'string', enum: [name] } },
          },
        ]),
      ),
    },
    paths: Object.fromEntries(
      names.map((name, index) => [
        `/models/${index}`,
        {
          get: {
            operationId: `read${index}`,
            tags: ['models'],
            responses: {
              '200': {
                description: name,
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${name}` },
                  },
                },
              },
            },
          },
        },
      ]),
    ),
  };
}

function rootExports(dir: string) {
  using api = new API();
  const parsed = api.parseConfigFile(join(dir, 'tsconfig.json'));
  using program = api.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getProject().checker;
  const index = program.getSourceFile(join(dir, 'src', 'index.ts'));
  assert.ok(index);
  const module = checker.getSymbolAtLocation(index);
  assert.ok(module);
  return checker.getExportsOfModule(module).map((symbol) => symbol.name);
}

describe('generate — model names', () => {
  test('a model named like a root runtime export is renamed with a trailing underscore and the runtime export keeps its name', async () => {
    await using plain = await workspaceDirectory('generate-root-exports-');
    await using directory = await workspaceDirectory(
      'generate-reserved-models-',
    );
    await generate(specWithModels(['Widget']), {
      output: plain.path,
      name: 'Shop',
      readme: false,
      mode: 'full',
    });
    const runtimeNames = rootExports(plain.path).filter(
      (name) => /^[A-Z]/.test(name) && name !== 'Widget',
    );
    for (const name of ['Endpoints', 'NotFound', 'Ok', 'Servers', 'Shop']) {
      assert.ok(runtimeNames.includes(name), `root exports ${name}`);
    }

    await generate(specWithModels(runtimeNames), {
      output: directory.path,
      name: 'Shop',
      readme: false,
      mode: 'full',
    });
    writeFileSync(
      join(directory.path, 'src', 'consumer.ts'),
      [
        `import { APIError, NotFound, ParseError, Shop, type Endpoints, type NotFound_, type Ok_, type Shop_ } from './index.ts';`,
        `const client = new Shop({ baseUrl: 'https://shop.test' });`,
        ...runtimeNames.map(
          (name, index) =>
            `const read${index} = () => client.request('GET /models/${index}', {});\nexport const model${index}: Awaited<ReturnType<typeof read${index}>> = { kind: ${JSON.stringify(name)} };`,
        ),
        `export const ok: Ok_ = { kind: 'Ok' };`,
        `export const notFound: NotFound_ = { kind: 'NotFound' };`,
        `export const shop: Shop_ = { kind: 'Shop' };`,
        `export type Routes = keyof Endpoints;`,
        `void [APIError, NotFound, ParseError];`,
      ].join('\n'),
    );

    assert.deepEqual(
      typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
      [],
    );
  });

  test('lowercase and snake_case schema names that pascalcase into a runtime export or the client class are renamed', async () => {
    await using directory = await workspaceDirectory(
      'generate-reserved-lowercase-',
    );
    await generate(specWithModels(['ok', 'not_found', 'client']), {
      output: directory.path,
      readme: false,
      mode: 'full',
    });
    writeFileSync(
      join(directory.path, 'src', 'consumer.ts'),
      `
import { Client, NotFound, type Client_, type NotFound_, type Ok_ } from './index.ts';
export const ok: Ok_ = { kind: 'ok' };
export const notFound: NotFound_ = { kind: 'not_found' };
export const client: Client_ = { kind: 'client' };
void [new Client({ baseUrl: 'https://shop.test' }), NotFound];
`,
    );

    assert.deepEqual(
      typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
      [],
    );
  });

  test('two schemas that become the same TypeScript type are rejected', async () => {
    await using directory = await new TemporaryFiles().directory(
      'generate-duplicate-models-',
    );
    await assert.rejects(
      generate(specWithModels(['pet', 'Pet']), {
        output: directory.path,
        readme: false,
      }),
      (error: unknown) =>
        error instanceof TypeError &&
        error.message.includes('"pet"') &&
        error.message.includes('"Pet"') &&
        /TypeScript type Pet\b/.test(error.message),
    );
  });
});

describe('generate — pagination with an optional items array', () => {
  void test.each(
    [
      {
        type: 'offset',
        parameters: { limit: 'integer', offset: 'integer' },
        input: { limit: 2, offset: 0 },
      },
      {
        type: 'page',
        parameters: { page: 'integer', pageSize: 'integer' },
        input: { page: 1, pageSize: 2 },
      },
      {
        type: 'cursor',
        parameters: { cursor: 'string', limit: 'integer' },
        input: { limit: 2 },
      },
    ] as const,
    ({ type, parameters, input }) =>
      test(`a ${type}-paginated SDK compiles and treats a page without items as empty`, async () => {
        await using directory = await workspaceDirectory(
          'generate-optional-items-',
        );
        await generate(
          {
            openapi: '3.1.0',
            info: { title: 'Paged', version: '1.0.0' },
            servers: [{ url: 'https://paged.test' }],
            paths: {
              '/items': {
                get: {
                  operationId: 'listItems',
                  parameters: Object.entries(parameters).map(
                    ([name, kind]) => ({
                      in: 'query',
                      name,
                      schema: { type: kind },
                    }),
                  ),
                  responses: {
                    '200': {
                      description: 'Page',
                      content: {
                        'application/json': {
                          schema: {
                            type: 'object',
                            properties: {
                              data: {
                                type: 'array',
                                items: { type: 'string' },
                              },
                              hasMore: { type: 'boolean' },
                              ...(type === 'cursor'
                                ? { nextCursor: { type: 'string' } }
                                : {}),
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            output: directory.path,
            name: 'Paged',
            readme: false,
            mode: 'full',
          },
        );
        writeFileSync(
          join(directory.path, 'src', 'consumer.ts'),
          `
import { Paged } from './index.ts';
export async function read(fetch: (request: Request) => Promise<Response>) {
  const pages = await new Paged({ baseUrl: 'https://paged.test', fetch }).request('GET /items', ${JSON.stringify(input)});
  const received: string[][] = [];
  for await (const page of pages) received.push(page.data);
  return received;
}
`,
        );
        assert.deepEqual(
          typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
          [],
        );

        const bundlePath = join(directory.path, 'consumer.cjs');
        await esbuild({
          entryPoints: [join(directory.path, 'src', 'consumer.ts')],
          bundle: true,
          outfile: bundlePath,
          format: 'cjs',
          platform: 'node',
          logLevel: 'silent',
        });
        const {
          read,
        }: {
          read(
            fetch: (request: Request) => Promise<Response>,
          ): Promise<unknown>;
        } = createRequire(import.meta.url)(bundlePath);
        const pages = [
          { data: ['a', 'b'], hasMore: true, nextCursor: '2' },
          { hasMore: false },
        ];

        const received = await read(async () => Response.json(pages.shift()));

        assert.deepEqual(received, [['a', 'b'], []]);
      }),
  );
});

describe('generate — pagination with coerced numeric parameters', () => {
  void test.each(
    [
      {
        name: 'page and pageSize',
        parameters: ['page', 'pageSize'],
        defaults: false,
        input: { page: 1, pageSize: 2 },
        progression: ['page=1&pageSize=2', 'page=2&pageSize=2'],
      },
      {
        name: 'limit and offset',
        parameters: ['limit', 'offset'],
        defaults: false,
        input: { limit: 2, offset: 0 },
        progression: ['limit=2&offset=0', 'limit=2&offset=2'],
      },
      {
        name: 'page and limit with defaults',
        parameters: ['page', 'limit'],
        defaults: true,
        input: { page: 1, limit: 2 },
        progression: ['limit=2&page=1', 'limit=2&page=2'],
      },
    ] as const,
    ({ name, parameters, defaults, input, progression }) =>
      test(`a paginated SDK with coerced ${name} compiles and advances pages`, async () => {
        await using directory = await workspaceDirectory(
          'generate-coerced-pages-',
        );
        await generate(
          {
            openapi: '3.1.0',
            info: { title: 'Paged', version: '1.0.0' },
            servers: [{ url: 'https://paged.test' }],
            paths: {
              '/items': {
                get: {
                  operationId: 'listItems',
                  parameters: parameters.map((name) => ({
                    in: 'query',
                    name,
                    schema: {
                      type: 'integer',
                      'x-zod-type': 'coerce-number',
                      ...(defaults ? { default: 1 } : {}),
                    },
                  })),
                  responses: {
                    '200': {
                      description: 'Page',
                      content: {
                        'application/json': {
                          schema: {
                            type: 'object',
                            required: ['data', 'hasMore'],
                            properties: {
                              data: {
                                type: 'array',
                                items: { type: 'string' },
                              },
                              hasMore: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            output: directory.path,
            name: 'Paged',
            readme: false,
            mode: 'full',
          },
        );
        writeFileSync(
          join(directory.path, 'src', 'consumer.ts'),
          `
import { Paged } from './index.ts';
export async function read(fetch: (request: Request) => Promise<Response>) {
  const pages = await new Paged({ baseUrl: 'https://paged.test', fetch }).request('GET /items', ${JSON.stringify(input)});
  const received: string[][] = [];
  for await (const page of pages) received.push(page.data);
  return received;
}
`,
        );
        assert.deepEqual(
          typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
          [],
        );

        const bundlePath = join(directory.path, 'consumer.cjs');
        await esbuild({
          entryPoints: [join(directory.path, 'src', 'consumer.ts')],
          bundle: true,
          outfile: bundlePath,
          format: 'cjs',
          platform: 'node',
          logLevel: 'silent',
        });
        const {
          read,
        }: {
          read(
            fetch: (request: Request) => Promise<Response>,
          ): Promise<unknown>;
        } = createRequire(import.meta.url)(bundlePath);
        const queries: string[] = [];
        const pages = [
          { data: ['a', 'b'], hasMore: true },
          { data: ['c'], hasMore: false },
        ];

        const received = await read(async (request) => {
          queries.push(new URL(request.url).searchParams.toString());
          return Response.json(pages.shift());
        });

        assert.deepEqual(received, [['a', 'b'], ['c']]);
        assert.deepEqual(queries, progression);
      }),
  );
});

test('operation groups whose tag starts with a digit generate valid identifiers', async () => {
  await using directory = await workspaceDirectory('generate-digit-groups-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Nums', version: '1.0.0' },
      servers: [{ url: 'https://nums.test' }],
      paths: {
        '/models/0': {
          get: {
            operationId: 'readZero',
            responses: {
              '200': {
                description: 'Zero',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        '/v2/2fa': {
          post: {
            operationId: 'enable2fa',
            responses: { '204': { description: 'Enabled' } },
          },
        },
      },
    },
    {
      output: directory.path,
      name: 'Nums',
      readme: false,
      mode: 'full',
      agentTools: 'ai-sdk',
    },
  );
  writeFileSync(
    join(directory.path, 'src', 'consumer.ts'),
    `
import { Nums } from './index.ts';
const client = new Nums({ baseUrl: 'https://nums.test' });
export const zero = () => client.request('GET /models/0', {});
export const twoFactor = () => client.request('POST /v2/2fa', {});
`,
  );

  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});

test('a schema or operation group named index keeps its module beside the folder barrel', async () => {
  await using directory = await workspaceDirectory('generate-index-names-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Idx', version: '1.0.0' },
      servers: [{ url: 'https://idx.test' }],
      components: {
        schemas: {
          index: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
          Catalog: {
            type: 'object',
            required: ['entries'],
            properties: {
              entries: {
                type: 'array',
                items: { $ref: '#/components/schemas/index' },
              },
            },
          },
        },
      },
      paths: {
        '/index': {
          get: {
            operationId: 'readIndex',
            tags: ['index'],
            responses: {
              '200': {
                description: 'Index',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/index' },
                  },
                },
              },
            },
          },
        },
        '/catalog': {
          get: {
            operationId: 'readCatalog',
            tags: ['catalog'],
            responses: {
              '200': {
                description: 'Catalog',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Catalog' },
                  },
                },
              },
            },
          },
        },
      },
    },
    { output: directory.path, name: 'Idx', readme: false, mode: 'full' },
  );
  writeFileSync(
    join(directory.path, 'src', 'consumer.ts'),
    `
import { Idx, type Catalog, type Index } from './index.ts';
const client = new Idx({ baseUrl: 'https://idx.test' });
export const index: () => Promise<Index> = () => client.request('GET /index', {});
export const catalog: () => Promise<Catalog> = () => client.request('GET /catalog', {});
export const entry: Index = { name: 'a' };
`,
  );

  assert.deepEqual(
    typecheck(join(directory.path, 'tsconfig.json')).diagnostics,
    [],
  );
});
