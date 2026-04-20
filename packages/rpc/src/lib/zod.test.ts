import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type ZodObject, type ZodTypeAny } from 'zod';

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

  test('anyOf with date-time string and null preserves datetime validation', () => {
    const schema = converter.handle(
      {
        anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
      },
      false,
    );

    // valid ISO datetime passes
    assert.equal(schema.safeParse('2024-01-01T00:00:00Z').success, true);

    // invalid datetime string fails (proves .datetime() is applied)
    assert.equal(schema.safeParse('not-a-date').success, false);

    // null passes
    assert.equal(schema.safeParse(null).success, true);

    // undefined passes (optional)
    assert.equal(schema.safeParse(undefined).success, true);
  });

  test('preserves description on $ref with sibling description', () => {
    const spec = {
      components: {
        schemas: {
          UserId: { type: 'string' },
        },
      },
    };
    const refConverter = new RuntimeZodConverter(spec as never);
    const schema = refConverter.handle(
      { $ref: '#/components/schemas/UserId', description: 'User identifier' },
      true,
    );
    assert.equal(schema.description, 'User identifier');
    assert.equal(schema.safeParse('abc').success, true);
  });

  test('preserves description on string schema', () => {
    const schema = converter.handle(
      { type: 'string', description: 'The user name' },
      true,
    );
    assert.equal(schema.description, 'The user name');
  });

  test('preserves description on object properties', () => {
    const schema = converter.handle(
      {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'The user name' },
          age: { type: 'integer', description: 'Age in years' },
        },
      },
      true,
    );

    const shape = (schema as ZodObject<Record<string, ZodTypeAny>>).shape;
    assert.equal(shape.name.description, 'The user name');
    assert.equal(shape.age.description, 'Age in years');
  });

  test('preserves description on enum schema', () => {
    const schema = converter.handle(
      {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
      },
      true,
    );
    assert.equal(schema.description, 'Sort direction');
  });

  test('preserves description on anyOf schema', () => {
    const schema = converter.handle(
      {
        anyOf: [{ type: 'string' }, { type: 'number' }],
        description: 'A flexible value',
      },
      true,
    );
    assert.equal(schema.description, 'A flexible value');
  });

  test('preserves description on oneOf schema', () => {
    const schema = converter.handle(
      {
        oneOf: [{ type: 'string' }, { type: 'number' }],
        description: 'One of string or number',
      },
      true,
    );
    assert.equal(schema.description, 'One of string or number');
  });

  test('preserves description on allOf schema', () => {
    const schema = converter.handle(
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
        description: 'Combined object',
      },
      true,
    );
    assert.equal(schema.description, 'Combined object');
  });

  test('no description when omitted', () => {
    const schema = converter.handle({ type: 'string' }, true);
    assert.equal(schema.description, undefined);
  });

  test('schema with no type accepts any value (z.unknown fallback)', () => {
    const schema = converter.handle({}, true);
    assert.equal(schema.safeParse('hello').success, true);
    assert.equal(schema.safeParse(42).success, true);
    assert.equal(schema.safeParse(null).success, true);
    assert.equal(schema.safeParse({ a: 1 }).success, true);
  });

  test('contentEncoding binary accepts Blob values', () => {
    const schema = converter.handle(
      { type: 'string', contentEncoding: 'binary' },
      true,
    );
    const blob = new Blob(['hello'], { type: 'text/plain' });
    assert.equal(schema.safeParse(blob).success, true);
  });

  test('format byte/binary accepts Blob values', () => {
    for (const format of ['byte', 'binary'] as const) {
      const schema = converter.handle({ type: 'string', format }, true);
      const blob = new Blob(['hello'], { type: 'text/plain' });
      assert.equal(
        schema.safeParse(blob).success,
        true,
        `format ${format} should accept Blob`,
      );
    }
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
