import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { renderModule } from '@sdk-it/typescript';

/**
 * Generates the SDK of a spec whose model `Row` has one property `value`
 * (required or not), beside `schemas`, and type-checks a consumer that states
 * `Row` is `{ value: <expected> }` (`{ value?: <expected> }` when optional)
 * under exactOptionalPropertyTypes. Returns the consumer's type errors and
 * the SDK text.
 */
async function rowModel(options: {
  value: SchemaObject;
  required: boolean;
  expected: string;
  schemas?: Record<string, SchemaObject>;
}) {
  const { text } = await renderModule(
    {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          ...options.schemas,
          Row: {
            type: 'object',
            properties: { value: options.value },
            required: options.required ? ['value'] : [],
          },
        },
      },
    },
    { name: 'Client' },
  );
  const property = options.required ? 'value' : 'value?';
  await using workspace = await analysisWorkspace(
    'interface-model-',
    {
      'sdk.ts': text,
      'consumer.ts': `import type { Row } from './sdk.ts';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export const same: Equal<Row, { ${property}: ${options.expected} }> = true;
`,
    },
    { exactOptionalPropertyTypes: true },
  );
  const consumer = join(workspace.path, 'consumer.ts');
  const errors = typecheck(workspace.tsconfig)
    .diagnostics.filter((diagnostic) => diagnostic.file === consumer)
    .map((diagnostic) => diagnostic.message);
  return { errors, text };
}

describe('TypeScriptEmitter date handling', () => {
  test('format date-time returns string', async () => {
    const { errors } = await rowModel({
      value: { type: 'string', format: 'date-time' },
      required: true,
      expected: 'string',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('format datetime returns string', async () => {
    const { errors } = await rowModel({
      value: { type: 'string', format: 'datetime' },
      required: true,
      expected: 'string',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('format date returns string', async () => {
    const { errors } = await rowModel({
      value: { type: 'string', format: 'date' },
      required: true,
      expected: 'string',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('format date-time optional returns string | undefined', async () => {
    const { errors } = await rowModel({
      value: { type: 'string', format: 'date-time' },
      required: false,
      expected: 'string | undefined',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('string without format returns string', async () => {
    const { errors } = await rowModel({
      value: { type: 'string' },
      required: true,
      expected: 'string',
    });
    assert.deepStrictEqual(errors, []);
  });
});

describe('TypeScriptEmitter union of string and string literals', () => {
  test('wraps bare string as (string & {}) when sibling literals are present', async () => {
    const { errors } = await rowModel({
      value: {
        anyOf: [
          { enum: ['Director'], type: 'string' },
          { type: 'string' },
          { enum: ['Analyst'], type: 'string' },
        ],
      },
      required: true,
      expected: "'Director' | (string & {}) | 'Analyst'",
    });
    assert.deepStrictEqual(errors, []);
  });

  test('does not wrap bare string when no literal siblings', async () => {
    const { errors } = await rowModel({
      value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      required: true,
      expected: 'string | number',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('does not wrap when bare string has format', async () => {
    const { errors } = await rowModel({
      value: {
        anyOf: [
          { enum: ['Director'], type: 'string' },
          { type: 'string', format: 'date-time' },
        ],
      },
      required: true,
      expected: "'Director' | string",
    });
    assert.deepStrictEqual(errors, []);
  });

  test('emits a single (string & {}) when union has duplicate bare strings', async () => {
    const { errors, text } = await rowModel({
      value: {
        anyOf: [
          { type: 'string' },
          { type: 'string' },
          { enum: ['Director'], type: 'string' },
        ],
      },
      required: true,
      expected: "(string & {}) | 'Director'",
    });
    assert.deepStrictEqual(errors, []);
    const row = text.split('\n').find((line) => line.includes('type Row ='));
    assert.equal(row?.split('(string & {})').length, 2, row);
  });

  test('wraps bare string when sibling uses const (not enum)', async () => {
    const { errors } = await rowModel({
      value: {
        anyOf: [{ type: 'string' }, { const: 'Director', type: 'string' }],
      },
      required: true,
      expected: "(string & {}) | 'Director'",
    });
    assert.deepStrictEqual(errors, []);
  });

  test('does not wrap when sibling literal is non-string (numeric const)', async () => {
    const { errors } = await rowModel({
      value: { anyOf: [{ type: 'string' }, { const: 1 }] },
      required: true,
      expected: 'string | 1',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('wraps bare string when literal sibling is a $ref', async () => {
    const { errors } = await rowModel({
      schemas: { DirectorRole: { const: 'Director', type: 'string' } },
      value: {
        anyOf: [
          { type: 'string' },
          { $ref: '#/components/schemas/DirectorRole' },
        ],
      },
      required: true,
      expected: "(string & {}) | 'Director'",
    });
    assert.deepStrictEqual(errors, []);
  });
});

describe('TypeScriptEmitter 64-bit integers', () => {
  // int64 stops being special: a number on the wire is a number, a string on
  // the wire is a string. No bigint.
  test('integer int64 is a plain number', async () => {
    const { errors } = await rowModel({
      value: { type: 'integer', format: 'int64' },
      required: true,
      expected: 'number',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('integer uint64 is a plain number', async () => {
    const { errors } = await rowModel({
      value: { type: 'integer', format: 'uint64' },
      required: true,
      expected: 'number',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('string-encoded int64 and uint64 are plain strings', async () => {
    const int64 = await rowModel({
      value: { type: 'string', format: 'int64' },
      required: true,
      expected: 'string',
    });
    const uint64 = await rowModel({
      value: { type: 'string', format: 'uint64' },
      required: true,
      expected: 'string',
    });
    assert.deepStrictEqual(int64.errors, []);
    assert.deepStrictEqual(uint64.errors, []);
  });
});

describe('TypeScriptEmitter nullable unions', () => {
  test('anyOf with a leading null member keeps null', async () => {
    const { errors } = await rowModel({
      value: { anyOf: [{ type: 'null' }, { type: 'string' }] },
      required: true,
      expected: 'null | string',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('anyOf with a trailing null member keeps null and adds undefined when optional', async () => {
    const { errors } = await rowModel({
      value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      required: false,
      expected: 'string | null | undefined',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('type array with null does not add undefined to a required property', async () => {
    const { errors } = await rowModel({
      value: { type: ['string', 'null'] },
      required: true,
      expected: 'string | null',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('type array with null adds undefined only when optional', async () => {
    const { errors } = await rowModel({
      value: { type: ['string', 'null'] },
      required: false,
      expected: 'string | null | undefined',
    });
    assert.deepStrictEqual(errors, []);
  });

  test('type array of two real types does not add undefined per member', async () => {
    const { errors } = await rowModel({
      value: { type: ['string', 'number'] },
      required: true,
      expected: 'string | number',
    });
    assert.deepStrictEqual(errors, []);
  });
});
