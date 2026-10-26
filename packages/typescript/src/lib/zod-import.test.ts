import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Store', version: '1.0.0' },
  security: [{ bearerAuth: [] }],
  paths: {
    '/products': {
      get: {
        operationId: 'listProducts',
        parameters: [
          { in: 'query', name: 'limit', schema: { type: 'integer' } },
          { in: 'query', name: 'offset', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'Products',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data', 'hasMore'],
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Product' },
                    },
                    hasMore: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createProduct',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Product' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Product' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Product: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  },
};

test('generated SDK imports zod by name so bundlers can drop the parts it does not use', async () => {
  await using workspace = await mkdtempDisposable(
    join(
      fileURLToPath(new URL('../../../../', import.meta.url)),
      '.zod-import-',
    ),
  );
  await generate(spec, {
    output: workspace.path,
    mode: 'minimal',
    readme: false,
    agentTools: 'ai-sdk',
  });

  const importsZod = new Map<string, string>();
  for (const file of await readdir(workspace.path, { recursive: true })) {
    if (!file.endsWith('.ts')) continue;
    const text = await readFile(join(workspace.path, file), 'utf8');
    const statement = /import\s+[^;]*?\s+from\s+['"]zod['"]/.exec(text);
    if (statement) importsZod.set(file, statement[0]);
  }

  for (const file of [
    'client.ts',
    'agents.ts',
    'api/endpoints.ts',
    'http/dispatcher.ts',
    'http/parser.ts',
    'http/security.ts',
  ]) {
    assert.ok(importsZod.has(file), `${file} should import zod`);
  }
  const defaultImports = [...importsZod].filter(
    ([, statement]) =>
      !/^import\s+(?:type\s+)?\{\s*z\s*\}\s+from/.test(statement),
  );
  assert.deepEqual(defaultImports, []);
});
