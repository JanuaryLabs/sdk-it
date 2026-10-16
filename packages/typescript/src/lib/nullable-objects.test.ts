import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SchemaObject } from 'openapi3-ts/oas31';
import ts from 'typescript';

import { generate } from '@sdk-it/typescript';

void test.each(
  ['inline', 'reference', 'array item', 'nested'] as const,
  (shape) =>
    test.each([false, true], (nullFirst) =>
      test(`generated SDK preserves nullable ${shape} objects with null ${nullFirst ? 'first' : 'last'}`, async () => {
        await using workspace = await mkdtempDisposable(
          join(
            fileURLToPath(new URL('../../../../', import.meta.url)),
            '.nullable-objects-',
          ),
        );
        try {
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
              mode: 'full',
              readme: false,
            },
          );
          const source = join(workspace.path, 'src');
          await writeFile(
            join(source, 'consumer.ts'),
            `
import assert from 'node:assert/strict';
import { Records } from './index.ts';

export async function exercise() {
  const client = new Records({ baseUrl: 'https://example.test', fetch: async (request: Request) => Response.json(await request.json()) });
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

function checkTypes(client: Records) {
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
          const config = ts.parseJsonConfigFileContent(
            {
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
            ts.sys,
            source,
          );
          assert.deepEqual(config.errors, []);
          const diagnostics = ts.getPreEmitDiagnostics(
            ts.createProgram(config.fileNames, config.options),
          );
          assert.equal(
            diagnostics.length,
            0,
            ts.formatDiagnosticsWithColorAndContext(diagnostics, {
              getCanonicalFileName: (file) => file,
              getCurrentDirectory: () => source,
              getNewLine: () => '\n',
            }),
          );
          const bundle = join(workspace.path, 'consumer.mjs');
          await build({
            entryPoints: [join(source, 'consumer.ts')],
            outfile: bundle,
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            logLevel: 'silent',
          });
          await (await import(pathToFileURL(bundle).href)).exercise();
        } finally {
          stop();
        }
      }),
    ),
);
