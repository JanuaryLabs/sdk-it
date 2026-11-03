import { TemporaryFiles } from '@zukhruf/testing/fs';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/dart';

const audited: SchemaObject = {
  allOf: [
    { $ref: '#/components/schemas/Base' },
    {
      type: 'object',
      properties: { createdBy: { type: 'string' } },
      required: ['createdBy'],
    },
  ],
};

async function dartSources(dir: string): Promise<string> {
  const files = await readdir(dir, { recursive: true });
  const sources = await Promise.all(
    files
      .filter((file) => file.endsWith('.dart'))
      .map((file) => readFile(join(dir, file), 'utf8')),
  );
  return sources.join('\n');
}

void test('allOf keeps every part required wherever the schema appears', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-dart-all-of-',
  );
  const output = join(workspace.path, 'client');
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Accounts API', version: '1.0.0' },
    components: {
      schemas: {
        Base: {
          type: 'object',
          properties: { id: { type: 'string' }, tenant: { type: 'string' } },
          required: ['id', 'tenant'],
        },
        Account: audited,
        Holder: {
          type: 'object',
          properties: { account: audited },
          required: ['account'],
        },
      },
    },
    paths: {
      '/accounts': {
        get: {
          operationId: 'listAccounts',
          tags: ['accounts'],
          responses: {
            '200': {
              description: 'Accounts',
              content: {
                'application/json': {
                  schema: { type: 'array', items: audited },
                },
              },
            },
          },
        },
      },
      '/accounts/{accountId}': {
        put: {
          operationId: 'updateAccount',
          tags: ['accounts'],
          parameters: [
            {
              in: 'path',
              name: 'accountId',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            content: { 'application/json': { schema: audited } },
          },
          responses: {
            '200': {
              description: 'Account',
              content: { 'application/json': { schema: audited } },
            },
          },
        },
      },
      '/holders': {
        get: {
          operationId: 'getHolder',
          tags: ['holders'],
          responses: {
            '200': {
              description: 'Holder',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Holder' },
                },
              },
            },
          },
        },
      },
    },
  };

  await generate(spec, { output });

  const sources = await dartSources(join(output, 'lib'));
  const optionalFields = [...sources.matchAll(/final String\? (\w+)/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(
    optionalFields.filter((name) =>
      ['id', 'tenant', 'createdBy'].includes(name),
    ),
    [],
  );
  assert.match(sources, /final String createdBy/);
  assert.match(sources, /final String tenant/);
});
