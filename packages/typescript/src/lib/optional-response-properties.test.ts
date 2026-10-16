import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import ts from 'typescript';

import { generate } from '@sdk-it/typescript';

void test.each(
  [
    'inline object',
    'inferred object',
    'reference',
    'array',
    'dictionary',
  ] as const,
  (shape) =>
    test(`generated response preserves optional ${shape} properties`, async () => {
      await using workspace = await mkdtempDisposable(
        join(
          fileURLToPath(new URL('../../../../', import.meta.url)),
          '.optional-response-',
        ),
      );
      const recordObject: SchemaObject = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['id'],
      };
      const schemas: Record<typeof shape, SchemaObject | ReferenceObject> = {
        'inline object': recordObject,
        'inferred object': {
          properties: recordObject.properties,
          required: ['id'],
        },
        reference: { $ref: '#/components/schemas/RecordDetails' },
        array: { type: 'array', items: recordObject },
        dictionary: { type: 'object', additionalProperties: recordObject },
      };
      const value = (fields: string) => {
        if (shape === 'array') return `[{ ${fields} }]`;
        if (shape === 'dictionary') return `{ entry: { ${fields} } }`;
        return `{ ${fields} }`;
      };
      await generate(
        {
          openapi: '3.1.0',
          info: { title: 'Records', version: '1.0.0' },
          components: { schemas: { RecordDetails: recordObject } },
          paths: {
            '/records': {
              get: {
                operationId: 'readRecords',
                tags: ['records'],
                responses: {
                  '200': {
                    description: 'Records',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          properties: {
                            status: { type: 'boolean' },
                            record: schemas[shape],
                            requiredRecord: schemas[shape],
                          },
                          required: ['status', 'requiredRecord'],
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
          output: workspace.path,
          name: 'Records',
          mode: 'full',
          readme: false,
        },
      );
      await writeFile(
        join(workspace.path, 'src/consumer.ts'),
        `
import { Records } from './index.ts';
const client = new Records({ baseUrl: 'https://example.test' });
const read = () => client.request('GET /records', {});
type Value = Awaited<ReturnType<typeof read>>;
const omitted: Value = { status: true, requiredRecord: ${value("id: 'required'")} };
const present: Value = { status: true, requiredRecord: ${value("id: 'required'")}, record: ${value("id: 'optional'")} };
const withNote: Value = { status: true, requiredRecord: ${value("id: 'required'")}, record: ${value("id: 'optional', note: 'Details'")} };
const absent: Value['record'] = undefined;
// @ts-expect-error These non-nullable schemas do not permit null.
const nullValue: Value = { status: true, requiredRecord: null, record: null };
// @ts-expect-error The required object must still be present.
const missingRequired: Value = { status: true };
// @ts-expect-error A required object cannot be undefined.
const undefinedRequired: Value = { status: true, requiredRecord: undefined };
// @ts-expect-error A supplied record must contain its required ID.
const missingId: Value = { status: true, requiredRecord: ${value("id: 'required'")}, record: ${value('')} };
// @ts-expect-error The ID must still be a string.
const wrongId: Value = { status: true, requiredRecord: ${value("id: 'required'")}, record: ${value('id: 123')} };
declare const response: Value;
declare function consume(record: NonNullable<Value['record']>): void;
// @ts-expect-error An optional record must be checked before use.
consume(response.record);
if (response.record != null) consume(response.record);
void [omitted, present, withNote, absent, nullValue, missingRequired, undefinedRequired, missingId, wrongId];
`,
      );
      const configPath = join(workspace.path, 'tsconfig.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.compilerOptions.strict = true;
      const parsed = ts.parseJsonConfigFileContent(
        config,
        ts.sys,
        workspace.path,
      );
      assert.deepEqual(parsed.errors, []);
      const program = ts.createProgram(parsed.fileNames, parsed.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);
      assert.equal(
        diagnostics.length,
        0,
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => workspace.path,
          getNewLine: () => '\n',
        }),
      );
    }),
);
