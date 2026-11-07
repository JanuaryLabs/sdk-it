import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const spec: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Chat', version: '1.0.0' },
  paths: {
    '/chat/{chatId}/messages': {
      post: {
        operationId: 'postMessage',
        tags: ['chat'],
        parameters: [
          {
            name: 'chatId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  id: { type: 'string' },
                  note: { type: 'string' },
                },
                required: ['content', 'id'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/group-templates/{templateId}': {
      put: {
        operationId: 'updateGroupTemplate',
        tags: ['groupTemplates'],
        parameters: [
          {
            name: 'templateId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  agents: { type: 'array', items: { type: 'string' } },
                  name: { type: 'string' },
                },
                required: ['agents'],
              },
            },
          },
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

void test('required body properties stay required in the input type beside a path parameter', async () => {
  await using workspace = await workspaceDirectory('required-body-types-');
  await generate(spec, {
    output: workspace.path,
    name: 'Chat',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
  });
  await writeFile(
    join(workspace.path, 'src/consumer.ts'),
    `
import { createChat } from './index.ts';
const client = createChat({ baseUrl: 'https://example.test' });
void client.request('POST /chat/{chatId}/messages', { chatId: 'c1', content: 'hi', id: 'm1' });
void client.request('POST /chat/{chatId}/messages', { chatId: 'c1', content: 'hi', id: 'm1', note: 'n' });
// @ts-expect-error content is required by the request body.
void client.request('POST /chat/{chatId}/messages', { chatId: 'c1', id: 'm1' });
// @ts-expect-error id is required by the request body.
void client.request('POST /chat/{chatId}/messages', { chatId: 'c1', content: 'hi' });
// @ts-expect-error chatId is a required path parameter.
void client.request('POST /chat/{chatId}/messages', { content: 'hi', id: 'm1' });
void client.request('PUT /group-templates/{templateId}', { templateId: 't1', agents: ['a'] });
// @ts-expect-error agents is required by the request body.
void client.request('PUT /group-templates/{templateId}', { templateId: 't1', name: 'n' });
`,
  );
  const config = JSON.parse(
    await readFile(join(workspace.path, 'tsconfig.json'), 'utf8'),
  );
  config.compilerOptions.strict = true;

  const { files, diagnostics } = typecheck({
    tsconfig: config,
    directory: workspace.path,
  });

  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  assert.deepEqual(diagnostics, []);
});

void test('the generated client rejects a body missing a required property before fetch and sends only body fields', async () => {
  await using workspace = await workspaceDirectory('required-body-runtime-');
  await generate(spec, {
    output: workspace.path,
    name: 'Chat',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
  });
  const { createChat } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const requests: Request[] = [];
  const client = createChat({
    baseUrl: 'https://api.example.com',
    fetch: async (request: Request) => {
      requests.push(request);
      return Response.json({});
    },
  });

  await assert.rejects(
    client.request('POST /chat/{chatId}/messages', {
      chatId: 'c1',
      id: 'm1',
    }),
    parseErrorFor('content'),
  );
  await assert.rejects(
    client.request('PUT /group-templates/{templateId}', {
      templateId: 't1',
      name: 'n',
    }),
    parseErrorFor('agents'),
  );
  assert.equal(requests.length, 0);

  await client.request('POST /chat/{chatId}/messages', {
    chatId: 'c1',
    content: 'hi',
    id: 'm1',
  });
  assert.deepEqual(
    await Promise.all(
      requests.map(async (request) => ({
        url: request.url,
        body: await request.json(),
      })),
    ),
    [
      {
        url: 'https://api.example.com/chat/c1/messages',
        body: { content: 'hi', id: 'm1' },
      },
    ],
  );
});
