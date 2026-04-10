import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { rpc, toAgents } from './rpc.ts';

let tempDir: string;

function writeSpec(spec: object) {
  tempDir = mkdtempSync(join(tmpdir(), 'rpc-test-'));
  const specPath = join(tempDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  return specPath;
}

function cleanup() {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function makeSpec(
  overrides: {
    tags?: object[];
    paths?: object;
    servers?: object[];
  } = {},
) {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1.0.0' },
    servers: overrides.servers ?? [{ url: 'http://localhost:3000' }],
    tags: overrides.tags ?? [
      {
        name: 'users',
        'x-name': 'User Agent',
        'x-instructions': 'Handle user queries',
        'x-handoff-description': 'Handles user-related operations',
      },
    ],
    paths: overrides.paths ?? {
      '/users': {
        get: {
          operationId: 'listUsers',
          'x-fn-name': 'listUsers',
          'x-tool': { name: 'getUsers', description: 'List all users' },
          tags: ['users'],
          summary: 'List users',
          description: 'Returns a list of users',
          parameters: [
            {
              name: 'query',
              in: 'query',
              required: false,
              schema: { type: 'string', description: 'Search query' },
            },
          ],
          responses: {
            '200': {
              description: 'Success',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { users: { type: 'array' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('toAgents', () => {
  afterEach(() => cleanup());

  test('basic tool generation: returns agent with correct tool name and description', async () => {
    const spec = makeSpec();
    const path = writeSpec(spec);

    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    assert.ok(agents.users, 'should have a "users" agent group');
    assert.ok(agents.users.tools.getUsers, 'should have a "getUsers" tool');
    assert.equal(
      agents.users.tools.getUsers.description,
      'List all users',
      'tool description from x-tool.description',
    );
  });

  test('parameter descriptions are preserved in tool inputSchema', async () => {
    const spec = makeSpec({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            'x-fn-name': 'listUsers',
            'x-tool': { name: 'getUsers', description: 'List all users' },
            tags: ['users'],
            parameters: [
              {
                name: 'query',
                in: 'query',
                required: false,
                schema: { type: 'string', description: 'Search query' },
              },
              {
                name: 'activeOn',
                in: 'query',
                required: false,
                schema: {
                  type: 'string',
                  format: 'date-time',
                  'x-zod-type': 'coerce-date',
                  description:
                    'DO NOT include unless user explicitly asks about active date',
                },
              },
              {
                name: 'limit',
                in: 'query',
                required: false,
                schema: {
                  type: 'integer',
                  default: 10,
                  minimum: 1,
                  description: 'Max results to return',
                },
              },
              {
                name: 'noDesc',
                in: 'query',
                required: false,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    const toolDef = agents.users.tools.getUsers;
    const jsonSchema = zodToJsonSchema(toolDef.inputSchema) as any;

    assert.equal(
      jsonSchema.properties.query.description,
      'Search query',
      'string param description preserved',
    );
    assert.equal(
      jsonSchema.properties.activeOn.description,
      'DO NOT include unless user explicitly asks about active date',
      'coerce-date param description preserved',
    );
    assert.equal(
      jsonSchema.properties.limit.description,
      'Max results to return',
      'integer param description preserved',
    );
    assert.equal(
      jsonSchema.properties.noDesc?.description,
      undefined,
      'no phantom description on param without one',
    );
  });

  test('parameter types are correctly converted', async () => {
    const spec = makeSpec({
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-fn-name': 'listItems',
            'x-tool': { name: 'listItems', description: 'List items' },
            tags: ['users'],
            parameters: [
              {
                name: 'name',
                in: 'query',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'count',
                in: 'query',
                required: true,
                schema: { type: 'integer' },
              },
              {
                name: 'active',
                in: 'query',
                required: false,
                schema: { type: 'boolean' },
              },
              {
                name: 'sort',
                in: 'query',
                required: false,
                schema: { type: 'string', enum: ['asc', 'desc'] },
              },
              {
                name: 'limit',
                in: 'query',
                required: false,
                schema: { type: 'integer', default: 10 },
              },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    const toolDef = agents.users.tools.listItems;
    const jsonSchema = zodToJsonSchema(toolDef.inputSchema) as any;

    assert.equal(jsonSchema.properties.name.type, 'string');
    assert.equal(jsonSchema.properties.count.type, 'integer');
    assert.equal(jsonSchema.properties.active.type, 'boolean');
    assert.deepEqual(jsonSchema.properties.sort.enum, ['asc', 'desc']);
    assert.equal(jsonSchema.properties.limit.default, 10);
    // required: name and count are required, others optional
    assert.ok(jsonSchema.required.includes('name'), 'name is required');
    assert.ok(jsonSchema.required.includes('count'), 'count is required');
    assert.ok(!jsonSchema.required?.includes('active'), 'active is optional');
    assert.ok(!jsonSchema.required?.includes('sort'), 'sort is optional');
  });

  test('operations with different tags produce separate groups', async () => {
    const spec = makeSpec({
      tags: [
        {
          name: 'users',
          'x-name': 'User Agent',
          'x-instructions': 'Handle users',
          'x-handoff-description': 'User ops',
        },
        {
          name: 'posts',
          'x-name': 'Post Agent',
          'x-instructions': 'Handle posts',
          'x-handoff-description': 'Post ops',
        },
      ],
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            'x-fn-name': 'listUsers',
            'x-tool': { name: 'getUsers', description: 'List users' },
            tags: ['users'],
            parameters: [],
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
        '/posts': {
          get: {
            operationId: 'listPosts',
            'x-fn-name': 'listPosts',
            'x-tool': { name: 'getPosts', description: 'List posts' },
            tags: ['posts'],
            parameters: [],
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
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    assert.ok(agents.users, 'users group exists');
    assert.ok(agents.posts, 'posts group exists');
    assert.ok(agents.users.tools.getUsers, 'getUsers in users group');
    assert.ok(agents.posts.tools.getPosts, 'getPosts in posts group');
    assert.equal(
      agents.users.tools.getPosts,
      undefined,
      'getPosts not in users',
    );
    assert.equal(
      agents.posts.tools.getUsers,
      undefined,
      'getUsers not in posts',
    );
  });

  test('multiple operations with same tag are grouped together', async () => {
    const spec = makeSpec({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            'x-fn-name': 'listUsers',
            'x-tool': { name: 'getUsers', description: 'List users' },
            tags: ['users'],
            parameters: [],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
            },
          },
          post: {
            operationId: 'createUser',
            'x-fn-name': 'createUser',
            'x-tool': { name: 'createUser', description: 'Create user' },
            tags: ['users'],
            parameters: [],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
            },
          },
        },
      },
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    assert.ok(agents.users.tools.getUsers, 'getUsers present');
    assert.ok(agents.users.tools.createUser, 'createUser present');
    assert.equal(Object.keys(agents).length, 1, 'only one group');
  });

  test('tag metadata maps to agent properties', async () => {
    const spec = makeSpec();
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    assert.equal(agents.users.name, 'User Agent', 'x-name → name');
    assert.equal(
      agents.users.instructions,
      'Handle user queries',
      'x-instructions → instructions',
    );
    assert.equal(
      agents.users.handoffDescription,
      undefined,
      'handoffDescription is collected but not propagated to final agent output',
    );
  });

  test('useTools: "defined" only includes operations with x-tool', async () => {
    const spec = makeSpec({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            'x-fn-name': 'listUsers',
            'x-tool': { name: 'getUsers', description: 'List users' },
            tags: ['users'],
            parameters: [],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
            },
          },
          post: {
            operationId: 'createUser',
            'x-fn-name': 'createUser',
            // no x-tool
            tags: ['users'],
            parameters: [],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
            },
          },
        },
      },
    });
    const path = writeSpec(spec);

    const agentsFiltered = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
      useTools: 'defined',
    });
    assert.ok(agentsFiltered.users.tools.getUsers, 'x-tool op included');
    assert.equal(
      agentsFiltered.users.tools.createUser,
      undefined,
      'non-x-tool op excluded',
    );

    const agentsAll = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });
    assert.ok(agentsAll.users.tools.getUsers, 'x-tool op included');
    assert.ok(agentsAll.users.tools.createUser, 'non-x-tool op also included');
  });

  test('description falls back from x-tool → operation.description → summary', async () => {
    const spec = makeSpec({
      paths: {
        '/a': {
          get: {
            operationId: 'opA',
            'x-fn-name': 'opA',
            'x-tool': { name: 'toolA', description: 'From x-tool' },
            tags: ['users'],
            summary: 'Summary A',
            description: 'Description A',
            parameters: [],
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
        '/b': {
          get: {
            operationId: 'opB',
            'x-fn-name': 'opB',
            'x-tool': { name: 'toolB' },
            tags: ['users'],
            summary: 'Summary B',
            description: 'Description B',
            parameters: [],
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
        '/c': {
          get: {
            operationId: 'opC',
            'x-fn-name': 'opC',
            'x-tool': { name: 'toolC' },
            tags: ['users'],
            summary: 'Summary C',
            parameters: [],
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
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    assert.equal(
      agents.users.tools.toolA.description,
      'From x-tool',
      'x-tool.description takes priority',
    );
    assert.equal(
      agents.users.tools.toolB.description,
      'Description B',
      'falls back to operation.description',
    );
    assert.equal(
      agents.users.tools.toolC.description,
      'Summary C',
      'falls back to operation.summary',
    );
  });

  test('tool name falls back to x-fn-name when x-tool has no name', async () => {
    const spec = makeSpec({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            'x-fn-name': 'listUsers',
            'x-tool': { description: 'List users but no tool name' },
            tags: ['users'],
            parameters: [],
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
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    assert.ok(
      agents.users.tools.listUsers,
      'tool keyed by x-fn-name when x-tool.name is absent',
    );
    assert.equal(
      agents.users.tools.listUsers.description,
      'List users but no tool name',
    );
  });

  test('empty spec with no paths produces empty agents', async () => {
    const spec = makeSpec({ paths: {}, tags: [] });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });
    assert.deepEqual(agents, {});
  });

  test('operation with no matching tag is skipped without crashing', async () => {
    const spec = makeSpec({
      tags: [], // no tag definitions
      paths: {
        '/orphan': {
          get: {
            operationId: 'orphanOp',
            'x-fn-name': 'orphanOp',
            'x-tool': { name: 'orphan', description: 'Orphan' },
            tags: ['nonexistent'],
            parameters: [],
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
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });
    assert.equal(agents.nonexistent, undefined, 'orphan tag not in agents');
  });

  test('path parameters are included in the input schema', async () => {
    const spec = makeSpec({
      paths: {
        '/users/{userId}': {
          get: {
            operationId: 'getUser',
            'x-fn-name': 'getUser',
            'x-tool': { name: 'getUser', description: 'Get one user' },
            tags: ['users'],
            parameters: [
              {
                name: 'userId',
                in: 'path',
                required: true,
                schema: { type: 'string', description: 'The user ID' },
              },
            ],
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
    });
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
    });

    const toolDef = agents.users.tools.getUser;
    const jsonSchema = zodToJsonSchema(toolDef.inputSchema) as any;
    assert.ok(jsonSchema.properties.userId, 'path param in schema');
    assert.equal(
      jsonSchema.properties.userId.description,
      'The user ID',
      'path param description preserved',
    );
  });

  test('tool execute calls the correct endpoint and returns JSON string', async () => {
    const mockResponse = { users: [{ id: 1, name: 'Alice' }] };
    let capturedRequest: Request | null = null;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const spec = makeSpec();
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: 'http://localhost:3000',
      fetch: mockFetch as any,
    });

    const toolDef = agents.users.tools.getUsers;
    const result = await toolDef.execute(
      { query: 'test' },
      {
        toolCallId: 'test-call',
        messages: [],
      },
    );

    const req = capturedRequest!;
    assert.ok(req, 'fetch was called');
    assert.ok(req.url.includes('/users'), 'request URL includes /users');
    assert.equal(req.method, 'GET', 'request method is GET');

    const parsed = JSON.parse(result as string);
    assert.deepEqual(
      parsed.data,
      { users: [{ id: 1, name: 'Alice' }] },
      'response data matches mock',
    );
  });

  test('tool execute resolves baseUrl functions for each request', async () => {
    const capturedUrls: string[] = [];
    let currentBaseUrl = 'http://localhost:3000';

    const mockFetch = async (request: Request) => {
      capturedUrls.push(request.url);
      return new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const spec = makeSpec();
    const path = writeSpec(spec);
    const agents = await toAgents(path, {
      baseUrl: () => currentBaseUrl,
      fetch: mockFetch as any,
    });

    await agents.users.tools.getUsers.execute(
      {},
      {
        toolCallId: 'test-call-1',
        messages: [],
      },
    );

    currentBaseUrl = 'http://localhost:4000';

    await agents.users.tools.getUsers.execute(
      {},
      {
        toolCallId: 'test-call-2',
        messages: [],
      },
    );

    assert.ok(
      capturedUrls[0]?.startsWith('http://localhost:3000/users'),
      'first request uses initial baseUrl',
    );
    assert.ok(
      capturedUrls[1]?.startsWith('http://localhost:4000/users'),
      'second request uses updated baseUrl',
    );
  });
});

describe('rpc', () => {
  afterEach(() => cleanup());

  test('passes AbortSignal from client.request to the transport request', async () => {
    const spec = makeSpec();
    const path = writeSpec(spec);
    let receivedRequest: Request | undefined;

    const client = await rpc(path, {
      fetch: async (request: Request) => {
        receivedRequest = request;
        return new Response(JSON.stringify({ users: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const controller = new AbortController();
    const response = await client.request('GET /users', {}, {
      signal: controller.signal,
    });

    assert.ok(receivedRequest);
    assert.equal(receivedRequest.signal.aborted, false);
    controller.abort();
    assert.equal(receivedRequest.signal.aborted, true);
    assert.equal(response.status, 200);
  });
});
