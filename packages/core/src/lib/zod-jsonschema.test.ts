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
