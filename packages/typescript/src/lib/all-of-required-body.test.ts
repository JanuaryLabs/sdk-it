import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const sourcedAccount: SchemaObject = {
  allOf: [
    { $ref: '#/components/schemas/DiscoveredAccount' },
    {
      type: 'object',
      properties: { dataSourceId: { type: 'string' } },
      required: ['dataSourceId'],
    },
  ],
};

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Sources', version: '1.0.0' },
  components: {
    schemas: {
      DiscoveredAccount: {
        type: 'object',
        properties: {
          detail: { type: 'string' },
          displayName: { type: 'string' },
          externalId: { type: 'string' },
        },
        required: ['detail', 'displayName', 'externalId'],
      },
    },
  },
  paths: {
    '/accounts/discovered': {
      get: {
        operationId: 'listDiscoveredAccounts',
        tags: ['sources'],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    found: { type: 'array', items: sourcedAccount },
                  },
                  required: ['found'],
                },
              },
            },
          },
        },
      },
    },
    '/sources/{sourceId}/accounts': {
      post: {
        operationId: 'addAccount',
        tags: ['sources'],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: sourcedAccount } },
        },
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

const typecheckConsumer = async (prefix: string, consumer: string) => {
  await using workspace = await workspaceDirectory(prefix);
  await generate(spec, {
    output: workspace.path,
    name: 'Sources',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
  });
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `
import { createSources } from './index.ts';
const client = createSources({ baseUrl: 'https://example.test' });
${consumer}`,
  );
  const config = JSON.parse(
    await readFile(join(workspace.path, 'tsconfig.json'), 'utf8'),
  );
  config.compilerOptions.strict = true;
  return typecheck({ tsconfig: config, directory: workspace.path });
};

void test('allOf response items keep every required property', async () => {
  const { files, diagnostics } = await typecheckConsumer(
    'all-of-required-response-',
    `
const list = () => client.request('GET /accounts/discovered', {});
type Item = Awaited<ReturnType<typeof list>>['found'][number];
declare const item: Item;
const detail: string = item.detail;
const displayName: string = item.displayName;
const externalId: string = item.externalId;
const dataSourceId: string = item.dataSourceId;
// @ts-expect-error detail is a string, so item is not any.
const notNumber: number = item.detail;
void [detail, displayName, externalId, dataSourceId, notNumber];
`,
  );

  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});

void test('an allOf request body beside a path parameter keeps every required property', async () => {
  const { files, diagnostics } = await typecheckConsumer(
    'all-of-required-request-',
    `
void client.request('POST /sources/{sourceId}/accounts', { sourceId: 'src', detail: 'd', displayName: 'n', externalId: 'e', dataSourceId: 's' });
// @ts-expect-error detail is required by DiscoveredAccount.
void client.request('POST /sources/{sourceId}/accounts', { sourceId: 'src', displayName: 'n', externalId: 'e', dataSourceId: 's' });
// @ts-expect-error displayName is required by DiscoveredAccount.
void client.request('POST /sources/{sourceId}/accounts', { sourceId: 'src', detail: 'd', externalId: 'e', dataSourceId: 's' });
// @ts-expect-error externalId is required by DiscoveredAccount.
void client.request('POST /sources/{sourceId}/accounts', { sourceId: 'src', detail: 'd', displayName: 'n', dataSourceId: 's' });
// @ts-expect-error dataSourceId is required by the allOf extension.
void client.request('POST /sources/{sourceId}/accounts', { sourceId: 'src', detail: 'd', displayName: 'n', externalId: 'e' });
`,
  );

  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});
