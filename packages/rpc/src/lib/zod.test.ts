import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RuntimeZodConverter } from './zod.ts';

describe('RuntimeZodConverter', () => {
  const converter = new RuntimeZodConverter({} as never);

  test('coerce-string preserves string coercion', () => {
    const result = converter
      .handle({ type: 'string', 'x-zod-type': 'coerce-string' }, true)
      .safeParse(42);

    assert.equal(result.success, true);
    assert.equal(result.data, '42');
  });

  test('coerce-boolean preserves boolean coercion', () => {
    const result = converter
      .handle({ type: 'boolean', 'x-zod-type': 'coerce-boolean' }, true)
      .safeParse('true');

    assert.equal(result.success, true);
    assert.equal(result.data, true);
  });

  test('coerce-number preserves integer constraints and defaults', () => {
    const schema = converter.handle(
      {
        type: 'integer',
        minimum: 0,
        default: 1,
        'x-zod-type': 'coerce-number',
      },
      true,
    );

    const parsedString = schema.safeParse('5');
    assert.equal(parsedString.success, true);
    assert.equal(parsedString.data, 5);

    const parsedUndefined = schema.safeParse(undefined);
    assert.equal(parsedUndefined.success, true);
    assert.equal(parsedUndefined.data, 1);

    assert.equal(schema.safeParse('5.2').success, false);
  });

  test('coerce-bigint preserves bigint coercion and defaults', () => {
    const schema = converter.handle(
      {
        type: 'integer',
        format: 'int64',
        default: 1,
        'x-zod-type': 'coerce-bigint',
      },
      true,
    );

    const parsedString = schema.safeParse('5');
    assert.equal(parsedString.success, true);
    assert.equal(parsedString.data, 5n);

    const parsedUndefined = schema.safeParse(undefined);
    assert.equal(parsedUndefined.success, true);
    assert.equal(parsedUndefined.data, 1n);
  });
});
