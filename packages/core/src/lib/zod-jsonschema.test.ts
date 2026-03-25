import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evalZod } from './zod-jsonschema.ts';

function getNonNullBranch(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const anyOf = schema.anyOf;
  assert.ok(Array.isArray(anyOf), 'expected schema.anyOf to be an array');
  const nonNullBranch = anyOf.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      'type' in candidate &&
      candidate.type !== 'null',
  );
  assert.ok(nonNullBranch && typeof nonNullBranch === 'object');
  return nonNullBranch;
}

describe('evalZod', () => {
  test('preserves wrapped coerce metadata for supported primitive schemas', async () => {
    const cases = [
      {
        name: 'number',
        source:
          'z.coerce.number().int().positive().default(1).nullish().transform((v) => v ?? 1)',
        expected: {
          type: 'integer',
          exclusiveMinimum: 0,
          default: 1,
          'x-zod-type': 'coerce-number',
        },
      },
      {
        name: 'date',
        source:
          'z.coerce.date().default(new Date(0)).nullish().transform((v) => v ?? new Date(0))',
        expected: {
          type: 'string',
          format: 'date-time',
          default: '1970-01-01T00:00:00.000Z',
          'x-zod-type': 'coerce-date',
        },
      },
      {
        name: 'bigint',
        source:
          'z.coerce.bigint().default(1n).nullish().transform((v) => v ?? 1n)',
        expected: {
          type: 'integer',
          format: 'int64',
          default: 1n,
          'x-zod-type': 'coerce-bigint',
        },
      },
      {
        name: 'boolean',
        source:
          'z.coerce.boolean().default(false).nullish().transform((v) => v ?? false)',
        expected: {
          type: 'boolean',
          default: false,
          'x-zod-type': 'coerce-boolean',
        },
      },
      {
        name: 'string',
        source:
          'z.coerce.string().trim().default("x").nullish().transform((v) => v ?? "x")',
        expected: {
          type: 'string',
          default: 'x',
          'x-zod-type': 'coerce-string',
        },
      },
    ] as const;

    for (const testCase of cases) {
      const { optional, schema } = await evalZod(testCase.source);
      assert.equal(optional, true, `${testCase.name} should be optional`);
      assert.deepStrictEqual(
        getNonNullBranch(schema),
        testCase.expected,
        `${testCase.name} should preserve its non-null branch metadata`,
      );
    }
  });

  test('preserves .describe() through ZodOptional override for all coerce types with .nullish()', async () => {
    const cases = [
      { name: 'coerce-number', source: 'z.coerce.number().nullish().describe("num desc")', desc: 'num desc' },
      { name: 'coerce-string', source: 'z.coerce.string().nullish().describe("str desc")', desc: 'str desc' },
      { name: 'coerce-boolean', source: 'z.coerce.boolean().nullish().describe("bool desc")', desc: 'bool desc' },
      { name: 'coerce-bigint', source: 'z.coerce.bigint().nullish().describe("bigint desc")', desc: 'bigint desc' },
      { name: 'coerce-date', source: 'z.coerce.date().nullish().describe("date desc")', desc: 'date desc' },
    ] as const;

    for (const { name, source, desc } of cases) {
      const { optional, schema } = await evalZod(source);
      assert.equal(optional, true, `${name} should be optional`);
      assert.equal(
        schema.description,
        desc,
        `${name}: description should be preserved at the top level`,
      );
    }
  });

  test('preserves .describe() on required schemas (no optional/nullable wrapper)', async () => {
    const cases = [
      { name: 'z.date()', source: 'z.date().describe("a date")', desc: 'a date', type: 'string', extra: { format: 'date-time', 'x-zod-type': 'date' } },
      { name: 'z.coerce.date()', source: 'z.coerce.date().describe("coerced date")', desc: 'coerced date', type: 'string', extra: { format: 'date-time', 'x-zod-type': 'coerce-date' } },
      { name: 'z.string()', source: 'z.string().describe("a string")', desc: 'a string', type: 'string', extra: {} },
      { name: 'z.number()', source: 'z.number().describe("a number")', desc: 'a number', type: 'number', extra: {} },
      { name: 'z.boolean()', source: 'z.boolean().describe("a bool")', desc: 'a bool', type: 'boolean', extra: {} },
    ] as const;

    for (const { name, source, desc, type, extra } of cases) {
      const { optional, schema } = await evalZod(source);
      assert.equal(optional, false, `${name} should not be optional`);
      assert.equal(schema.description, desc, `${name}: description should be preserved`);
      assert.equal(schema.type, type, `${name}: type should match`);
      for (const [k, v] of Object.entries(extra)) {
        assert.equal(schema[k], v, `${name}: ${k} should be ${v}`);
      }
    }
  });

  test('preserves .describe() on z.number().optional()', async () => {
    const { optional, schema } = await evalZod(
      'z.number().optional().describe("opt num")',
    );

    assert.equal(optional, true);
    assert.equal(schema.description, 'opt num');
    assert.equal(schema.type, 'number');
  });

  test('preserves .describe() on compound types with .nullish()', async () => {
    const cases = [
      { name: 'object', source: 'z.object({ a: z.string() }).nullish().describe("obj desc")', desc: 'obj desc' },
      { name: 'array', source: 'z.array(z.string()).nullish().describe("arr desc")', desc: 'arr desc' },
      { name: 'enum', source: 'z.enum(["a","b"]).nullish().describe("enum desc")', desc: 'enum desc' },
    ] as const;

    for (const { name, source, desc } of cases) {
      const { optional, schema } = await evalZod(source);
      assert.equal(optional, true, `${name} should be optional`);
      assert.equal(
        schema.description,
        desc,
        `${name}: description should be preserved at the top level`,
      );
    }
  });

  test('collapses primitive pipelines into a single schema', async () => {
    const { optional, schema } = await evalZod(
      'z.coerce.number().int().default(1).pipe(z.number().min(0)).nullish()',
    );

    assert.equal(optional, true);
    assert.deepStrictEqual(getNonNullBranch(schema), {
      type: 'integer',
      minimum: 0,
      default: 1,
      'x-zod-type': 'coerce-number',
    });
  });
});
