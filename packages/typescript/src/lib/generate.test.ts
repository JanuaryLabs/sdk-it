import { build as esbuild } from 'esbuild';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import ts from 'typescript';

import { generate } from '@sdk-it/typescript';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

function compileGeneratedProject(dir: string) {
  const configPath = join(dir, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dir,
  );
  const program = ts.createProgram(
    parsedConfig.fileNames,
    parsedConfig.options,
  );
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file?.fileName,
    line:
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line +
          1
        : undefined,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

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
    const dir = mkdtempSync(join(tmpdir(), 'generate-dictionary-'));
    try {
      await generate(dictionaryRequestSpec(), {
        output: dir,
        name: 'Dictionaries',
        readme: false,
      });

      const bundlePath = join(dir, 'settings-schema.cjs');
      await esbuild({
        entryPoints: [join(dir, 'inputs', 'settings.ts')],
        bundle: true,
        outfile: bundlePath,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        absWorkingDir: dir,
        nodePaths: [join(repoRoot, 'node_modules')],
        logLevel: 'silent',
      });
      const generated = createRequire(import.meta.url)(bundlePath) as {
        updateSettingsSchema: {
          safeParse(value: unknown): { success: boolean };
        };
      };

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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generate — discriminated input unions', () => {
  test('client.prepare accepts objects matching one discriminator branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-discriminated-input-'));
    try {
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
        { output: dir, name: 'Messages', readme: false },
      );

      const bundlePath = join(dir, 'client.cjs');
      await esbuild({
        entryPoints: [join(dir, 'index.ts')],
        bundle: true,
        outfile: bundlePath,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        absWorkingDir: dir,
        nodePaths: [join(repoRoot, 'node_modules')],
        logLevel: 'silent',
      });
      const { Messages } = createRequire(import.meta.url)(bundlePath) as {
        Messages: new (options: { baseUrl: string }) => {
          prepare(endpoint: string, input: unknown): Promise<unknown>;
        };
      };
      const client = new Messages({ baseUrl: 'https://api.example.com' });

      for (const role of ['system', 'user']) {
        await client.prepare('POST /messages', {
          messages: [{ role, content: 'hello' }],
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generate — impossible schemas', () => {
  test('emits never arrays for schemas that reject every item', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-never-response-'));
    try {
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
          output: dir,
          name: 'Impossible',
          readme: false,
        },
      );

      const source = readFileSync(
        join(dir, 'outputs', 'list-impossible.ts'),
        'utf8',
      );
      assert.match(source, /export type ListImpossible = \(never\)\[\];/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('emits z.never for request schemas that reject every value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-never-input-'));
    try {
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
          output: dir,
          name: 'Impossible',
          readme: false,
        },
      );

      const source = readFileSync(join(dir, 'inputs', 'impossible.ts'), 'utf8');
      assert.match(source, /'value': z\.never\(\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generate — AI SDK 7 agent tools', () => {
  test('emits type-correct projects for every agent runtime', async () => {
    for (const agentTools of ['ai-sdk', 'openai-agents'] as const) {
      const dir = mkdtempSync(join(repoRoot, '.generate-agent-typecheck-'));
      try {
        await generate(agentToolSpec(), {
          output: dir,
          name: 'AgentTools',
          readme: false,
          agentTools,
          mode: 'full',
        });

        const diagnostics = compileGeneratedProject(dir);
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
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('reads the tool-specific context from execution options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-ai-sdk-tools-'));
    try {
      await generate(agentToolSpec(), {
        output: dir,
        name: 'AgentTools',
        readme: false,
        agentTools: 'ai-sdk',
        mode: 'full',
      });

      const source = readFileSync(join(dir, 'src/agents.ts'), 'utf8');
      const packageJson = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as {
        dependencies: Record<string, string>;
        engines?: { node?: string };
      };
      assert.match(source, /coerceContext\(options\.context\)/);
      assert.doesNotMatch(source, /experimental_context/);
      assert.equal(packageJson.dependencies.ai, '^7.0.29');
      assert.equal(packageJson.engines?.node, '>=22');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declares the current OpenAI Agents SDK for generated tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-openai-tools-'));
    try {
      await generate(agentToolSpec(), {
        output: dir,
        name: 'OpenAIAgentTools',
        readme: false,
        agentTools: 'openai-agents',
        mode: 'full',
      });

      const source = readFileSync(join(dir, 'src/agents.ts'), 'utf8');
      const packageJson = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { dependencies: Record<string, string> };
      assert.match(source, /maybeContext\?\.context/);
      assert.equal(packageJson.dependencies['@openai/agents'], '^0.13.4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generate — client initialization', () => {
  test('README omits a sole server URL but shows an explicit choice for multiple URLs', async () => {
    const directories = [
      mkdtempSync(join(tmpdir(), 'generate-one-server-readme-')),
      mkdtempSync(join(tmpdir(), 'generate-multiple-server-readme-')),
    ];
    try {
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
            output: directories[index],
            name: 'Demo',
            readme: true,
          },
        );
        const readme = readFileSync(
          join(directories[index], 'README.md'),
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
    } finally {
      for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
});

describe('generate — security options assembly', () => {
  test('rejects unresolved external security schemes instead of generating an unauthenticated client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-external-security-'));
    try {
      await assert.rejects(
        generate(
          {
            openapi: '3.2.0',
            info: { title: 'External security', version: '1.0.0' },
            paths: {
              '/records': {
                get: {
                  operationId: 'getRecords',
                  security: [
                    { 'https://auth.example.com/security-scheme': [] },
                  ],
                  responses: { '204': { description: 'OK' } },
                },
              },
            },
          },
          { output: dir, name: 'ExternalSecurity', readme: false },
        ),
        /Security scheme https:\/\/auth\.example\.com\/security-scheme must be resolved/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('emits a type-correct client for the complete security scheme surface', async () => {
    const dir = mkdtempSync(join(repoRoot, '.generate-security-typecheck-'));
    try {
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
          output: dir,
          name: 'SecurityTypes',
          readme: false,
          mode: 'full',
        },
      );

      assert.deepStrictEqual(compileGeneratedProject(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('preserves each security alternative under its exact scheme name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-security-'));
    try {
      await generate(figmaShapedSpec(), {
        output: dir,
        name: 'Figma',
        readme: false,
      });

      const clientSource = readFileSync(join(dir, 'client.ts'), 'utf8');
      const httpIndexSource = readFileSync(join(dir, 'http/index.ts'), 'utf8');
      const source = readFileSync(join(dir, 'http/security.ts'), 'utf8');
      const credentialsBlock = source.slice(
        source.indexOf('const credentialsSchema'),
        source.indexOf('const securitySchemes'),
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('selects a satisfiable security alternative and suppresses credentials on public operations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-security-runtime-'));
    try {
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
        { output: dir, name: 'Security', readme: false },
      );

      const bundlePath = join(dir, 'client.cjs');
      await esbuild({
        entryPoints: [join(dir, 'index.ts')],
        bundle: true,
        outfile: bundlePath,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        absWorkingDir: dir,
        nodePaths: [join(repoRoot, 'node_modules')],
        logLevel: 'silent',
      });
      const { Security } = createRequire(import.meta.url)(bundlePath) as {
        Security: new (options: unknown) => {
          prepare(
            endpoint: string,
            input: unknown,
          ): Promise<{
            init: { headers: Headers };
          }>;
        };
      };
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sends the registered Authorization prefix whatever case the scheme uses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-http-scheme-'));
    try {
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
        { output: dir, name: 'HttpScheme', readme: false },
      );

      const bundlePath = join(dir, 'client.cjs');
      await esbuild({
        entryPoints: [join(dir, 'index.ts')],
        bundle: true,
        outfile: bundlePath,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        absWorkingDir: dir,
        nodePaths: [join(repoRoot, 'node_modules')],
        logLevel: 'silent',
      });
      const { HttpScheme } = createRequire(import.meta.url)(bundlePath) as {
        HttpScheme: new (options: unknown) => {
          prepare(
            endpoint: string,
            input: unknown,
          ): Promise<{ init: { headers: Headers } }>;
        };
      };
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prefers configured authentication over anonymous access and passes OAuth scopes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-optional-security-'));
    try {
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
        { output: dir, name: 'OptionalSecurity', readme: false },
      );

      const bundlePath = join(dir, 'client.cjs');
      await esbuild({
        entryPoints: [join(dir, 'index.ts')],
        bundle: true,
        outfile: bundlePath,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        absWorkingDir: dir,
        nodePaths: [join(repoRoot, 'node_modules')],
        logLevel: 'silent',
      });
      const { OptionalSecurity } = createRequire(import.meta.url)(
        bundlePath,
      ) as {
        OptionalSecurity: new (options: unknown) => {
          prepare(
            endpoint: string,
            input: unknown,
          ): Promise<{
            init: { headers: Headers };
          }>;
        };
      };
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('applies every scheme in an AND requirement across query, cookie, and mutual TLS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-and-security-'));
    try {
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
        { output: dir, name: 'AndSecurity', readme: false },
      );

      const bundlePath = join(dir, 'client.cjs');
      await esbuild({
        entryPoints: [join(dir, 'index.ts')],
        bundle: true,
        outfile: bundlePath,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        absWorkingDir: dir,
        nodePaths: [join(repoRoot, 'node_modules')],
        logLevel: 'silent',
      });
      const { AndSecurity } = createRequire(import.meta.url)(bundlePath) as {
        AndSecurity: new (options: unknown) => {
          prepare(
            endpoint: string,
            input: unknown,
          ): Promise<{
            url: URL;
            init: { headers: Headers };
          }>;
        };
      };
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('types credential values and providers for each security scheme', async () => {
    const dir = mkdtempSync(join(repoRoot, '.generate-mtls-typecheck-'));
    try {
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
        { output: dir, name: 'MutualTls', readme: false, mode: 'full' },
      );
      writeFileSync(
        join(dir, 'src/invalid-mtls.ts'),
        `import { MutualTls } from './index.ts';
new MutualTls({ baseUrl: '', credentials: { mtls: false } });
new MutualTls({ baseUrl: '', credentials: { mtls: 'certificate' } });
new MutualTls({ baseUrl: '', credentials: { mtls: () => 'certificate' } });
new MutualTls({ baseUrl: '', credentials: { bearer: true } });
new MutualTls({ baseUrl: '', credentials: { bearer: () => true } });
new MutualTls({ baseUrl: '', credentials: { basic: 'user:password' } });
new MutualTls({ baseUrl: '', credentials: { basic: () => 'user:password' } });
`,
      );

      const diagnostics = compileGeneratedProject(dir);
      assert.deepStrictEqual(
        diagnostics.map(({ file, line }) => ({
          file: file ? relative(dir, file) : undefined,
          line,
        })),
        [2, 3, 4, 5, 6, 7, 8].map((line) => ({
          file: join('src', 'invalid-mtls.ts'),
          line,
        })),
        `unexpected diagnostics:\n${diagnostics
          .map(({ file, line, message }) => `${file}:${line} ${message}`)
          .join('\n')}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    const dir = mkdtempSync(join(tmpdir(), 'generate-portable-'));
    try {
      await generate(uploadSpec(), {
        output: dir,
        name: 'Uploads',
        readme: false,
      });

      const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.ts'))
        .filter((file) =>
          readFileSync(join(dir, file), 'utf8').includes('z.instanceof('),
        );
      assert.deepEqual(
        offenders,
        [],
        'emitted client code must not reference runtime globals via z.instanceof',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Ground truth: execute the bundled SDK in a realm that actually lacks the
  // fetch-API globals, the way a worker or older Node would load it.
  test('generated SDK executes in a runtime without Blob/File/Request/Response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-vm-'));
    try {
      await generate(uploadSpec(), {
        output: dir,
        name: 'Uploads',
        readme: false,
      });

      const bundle = async () => {
        const outfile = join(dir, 'bundle.cjs');
        await esbuild({
          entryPoints: [join(dir, 'index.ts')],
          bundle: true,
          outfile,
          format: 'cjs',
          platform: 'node',
          target: 'node20',
          absWorkingDir: dir,
          nodePaths: [join(repoRoot, 'node_modules')],
          logLevel: 'silent',
        });
        return readFileSync(outfile, 'utf8');
      };

      const evaluate = (code: string) => {
        const moduleShim = { exports: {} as Record<string, unknown> };
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
      const inputsPath = join(dir, 'inputs', 'files.ts');
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
