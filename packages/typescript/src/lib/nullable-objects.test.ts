import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

void test.each(
  ['inline', 'reference', 'array item', 'nested'] as const,
  (shape) =>
    test.each([false, true], (nullFirst) =>
      test(`generated SDK preserves nullable ${shape} objects with null ${nullFirst ? 'first' : 'last'}`, async () => {
        await using workspace = await workspaceDirectory('nullable-objects-');
        const details: SchemaObject = {
          type: nullFirst ? ['null', 'object'] : ['object', 'null'],
          properties: { id: { type: 'string' }, note: { type: 'string' } },
          required: ['id'],
        };
        const field =
          shape === 'reference'
            ? { $ref: '#/components/schemas/Details' }
            : shape === 'array item'
              ? { type: 'array' as const, items: details }
              : shape === 'nested'
                ? {
                    type: 'object' as const,
                    properties: { child: details },
                    required: ['child'],
                  }
                : details;
        const value = (record: string) =>
          shape === 'array item'
            ? `[${record}]`
            : shape === 'nested'
              ? `{ child: ${record} }`
              : record;
        await generate(
          {
            openapi: '3.1.0',
            info: { title: 'Records', version: '1.0.0' },
            components: {
              schemas: {
                Details: details,
                Payload: {
                  type: 'object',
                  properties: {
                    requiredRecord: field,
                    optionalRecord: field,
                  },
                  required: ['requiredRecord'],
                },
              },
            },
            paths: {
              '/records': {
                post: {
                  operationId: 'writeRecords',
                  requestBody: {
                    required: true,
                    content: {
                      'application/json': {
                        schema: { $ref: '#/components/schemas/Payload' },
                      },
                    },
                  },
                  responses: {
                    '200': {
                      description: 'Records',
                      content: {
                        'application/json': {
                          schema: { $ref: '#/components/schemas/Payload' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            output: workspace.path,
            name: 'Records',
            packageName: '@acme/sdk',
            mode: 'full',
            readme: false,
          },
        );
        const source = join(workspace.path, 'src');
        await writeFile(
          join(source, 'consumer.ts'),
          `
import assert from 'node:assert/strict';
import { createRecords, type RecordsClient } from './index.ts';

export async function exercise() {
  const client = createRecords({ baseUrl: 'https://example.test', fetch: async (request: Request) => Response.json(await request.json()) });
  const valid = [
    { requiredRecord: ${value('null')} },
    { requiredRecord: ${value("{ id: 'required' }")}, optionalRecord: ${value('null')} },
    { requiredRecord: ${value('null')}, optionalRecord: ${value("{ id: 'optional', note: 'Details' }")} },
  ];
  for (const input of valid) {
    const prepared = await client.prepare('POST /records', input);
    assert.deepEqual(JSON.parse(String(prepared.init.body)), input);
    assert.deepEqual(await client.request('POST /records', input), input);
  }
  const invalid: unknown[] = [
    {},
    { requiredRecord: undefined },
    { requiredRecord: ${value('{}')} },
    { requiredRecord: ${value('{ id: 123 }')} },
    { requiredRecord: ${value('null')}, optionalRecord: ${value('{ id: 123 }')} },
  ];
  for (const input of invalid) {
    await assert.rejects(client.prepare('POST /records', input as never));
  }
}

function checkTypes(client: RecordsClient) {
  const read = () => client.request('POST /records', { requiredRecord: ${value('null')} });
  type Value = Awaited<ReturnType<typeof read>>;
  const omitted: Value = { requiredRecord: ${value('null')} };
  const present: Value = { requiredRecord: ${value("{ id: 'required' }")}, optionalRecord: ${value('null')} };
  const absent: Value['optionalRecord'] = undefined;
  // @ts-expect-error A required nullable property cannot be omitted.
  const missing: Value = {};
  // @ts-expect-error A required nullable property cannot be undefined.
  const undefinedRequired: Value = { requiredRecord: undefined };
  // @ts-expect-error A non-null object still requires its ID.
  const missingId: Value = { requiredRecord: ${value('{}')} };
  // @ts-expect-error A non-null object's ID must remain a string.
  const wrongId: Value = { requiredRecord: ${value('{ id: 123 }')} };
  // @ts-expect-error A required nullable input cannot be omitted.
  void client.prepare('POST /records', {});
  // @ts-expect-error A required nullable input cannot be undefined.
  void client.prepare('POST /records', { requiredRecord: undefined });
  void [omitted, present, absent, missing, undefinedRequired, missingId, wrongId];
}
void checkTypes;
`,
        );
        const { diagnostics } = typecheck({
          tsconfig: {
            compilerOptions: {
              target: 'ESNext',
              module: 'ESNext',
              moduleResolution: 'bundler',
              types: ['node'],
              strict: true,
              exactOptionalPropertyTypes: true,
              skipLibCheck: true,
              noEmit: true,
              allowImportingTsExtensions: true,
            },
            include: ['**/*.ts'],
          },
          directory: source,
        });
        assert.deepEqual(diagnostics, []);
        await (
          await import(pathToFileURL(join(source, 'consumer.ts')).href)
        ).exercise();
      }),
    ),
);
