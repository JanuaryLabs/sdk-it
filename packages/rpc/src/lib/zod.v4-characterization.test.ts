import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ZodType } from 'zod';

import { schemaToZod } from '@sdk-it/rpc';

const ir = {} as never;

describe('schemaToZod — v3→v4 characterization (string formats)', () => {
  test('format: ipv4 accepts valid IPv4 and rejects invalid', () => {
    const schema = schemaToZod({ type: 'string', format: 'ipv4' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('192.168.1.1').success, true);
    assert.equal(schema.safeParse('not-an-ip').success, false);
    assert.equal(schema.safeParse('::1').success, false);
  });

  test('format: ipv6 accepts valid IPv6 and rejects invalid', () => {
    const schema = schemaToZod({ type: 'string', format: 'ipv6' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('::1').success, true);
    assert.equal(schema.safeParse('2001:db8::1').success, true);
    assert.equal(schema.safeParse('192.168.1.1').success, false);
    assert.equal(schema.safeParse('nope').success, false);
  });

  test('format: date-time validates ISO 8601 strings', () => {
    const schema = schemaToZod({ type: 'string', format: 'date-time' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('2024-01-01T00:00:00Z').success, true);
    assert.equal(schema.safeParse('2024-01-01').success, false);
    assert.equal(schema.safeParse('not-a-date').success, false);
  });

  test('format: date validates calendar dates', () => {
    const schema = schemaToZod({ type: 'string', format: 'date' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('2024-01-01').success, true);
    assert.equal(schema.safeParse('2024-13-01').success, false);
    assert.equal(schema.safeParse('not-a-date').success, false);
  });

  test('format: email validates RFC-style addresses', () => {
    const schema = schemaToZod({ type: 'string', format: 'email' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('user@example.com').success, true);
    assert.equal(schema.safeParse('not-an-email').success, false);
  });

  test('format: uuid validates UUID strings', () => {
    const schema = schemaToZod({ type: 'string', format: 'uuid' }, ir, {
      required: true,
    });
    assert.equal(
      schema.safeParse('550e8400-e29b-41d4-a716-446655440000').success,
      true,
    );
    assert.equal(schema.safeParse('not-a-uuid').success, false);
  });

  test('format: uuid keeps v3 GUID semantics (no RFC 9562 variant enforcement)', () => {
    const schema = schemaToZod({ type: 'string', format: 'uuid' }, ir, {
      required: true,
    });
    // Microsoft-style GUID: variant nibble is not 8/9/a/b. Accepted by zod
    // v3's .uuid(); zod 4's z.uuid() rejects it, z.guid() accepts it.
    assert.equal(
      schema.safeParse('12345678-1234-1234-1234-123456789012').success,
      true,
    );
  });

  test('format: url and format: uri validate URL strings', () => {
    for (const format of ['url', 'uri'] as const) {
      const schema = schemaToZod({ type: 'string', format }, ir, {
        required: true,
      });
      assert.equal(
        schema.safeParse('https://example.com').success,
        true,
        `format ${format} should accept valid URL`,
      );
      assert.equal(
        schema.safeParse('not a url').success,
        false,
        `format ${format} should reject invalid URL`,
      );
    }
  });

  test('format: int64 on a string is a plain string (no coercion)', () => {
    const schema = schemaToZod({ type: 'string', format: 'int64' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('9007199254740993').success, true);
    assert.equal(schema.safeParse(Number('9007199254740993')).success, false);
  });

  test('format: time validates ISO time strings', () => {
    const schema = schemaToZod({ type: 'string', format: 'time' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('12:34:56').success, true);
    assert.equal(schema.safeParse('12:34').success, true);
    assert.equal(schema.safeParse('25:00:00').success, false);
    assert.equal(schema.safeParse('not-a-time').success, false);
    assert.equal(schema.safeParse(123).success, false);
  });
});

describe('schemaToZod — v3→v4 characterization (coerce markers)', () => {
  test('coerce-string converts number input to its string form', () => {
    const schema = schemaToZod(
      { type: 'string', 'x-zod-type': 'coerce-string' },
      ir,
      { required: true },
    );
    const r = schema.safeParse(42);
    assert.equal(r.success, true);
    assert.equal(r.data, '42');
  });

  test('coerce-number converts numeric string to number', () => {
    const schema = schemaToZod(
      { type: 'number', 'x-zod-type': 'coerce-number' },
      ir,
      { required: true },
    );
    const r = schema.safeParse('3.14');
    assert.equal(r.success, true);
    assert.equal(r.data, 3.14);
  });

  test('coerce-boolean parses boolean-ish strings semantically (v4 stringbool, not Boolean(x))', () => {
    const schema = schemaToZod(
      { type: 'boolean', 'x-zod-type': 'coerce-boolean' },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse(true).data, true);
    assert.equal(schema.safeParse(false).data, false);
    assert.equal(schema.safeParse('true').data, true);
    assert.equal(schema.safeParse('false').data, false);
    assert.equal(schema.safeParse('1').data, true);
    assert.equal(schema.safeParse('0').data, false);
    assert.equal(
      schema.safeParse('garbage').success,
      false,
      'ambiguous strings reject instead of silently becoming true',
    );
  });

  test('int64 is a plain integer — the coerce-bigint marker no longer coerces', () => {
    const schema = schemaToZod(
      {
        type: 'integer',
        format: 'int64',
        'x-zod-type': 'coerce-bigint',
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse(42).success, true);
    assert.equal(schema.safeParse('42').success, false);
  });

  test('coerce-date converts ISO string to Date instance', () => {
    const schema = schemaToZod(
      {
        type: 'string',
        format: 'date-time',
        'x-zod-type': 'coerce-date',
      },
      ir,
      { required: true },
    );
    const r = schema.safeParse('2024-01-01T00:00:00Z');
    assert.equal(r.success, true);
    assert.ok(r.data instanceof Date);
    assert.equal((r.data as Date).toISOString(), '2024-01-01T00:00:00.000Z');
  });

  test('x-zod-type: date requires a Date instance', () => {
    const schema = schemaToZod(
      {
        type: 'string',
        format: 'date-time',
        'x-zod-type': 'date',
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse(new Date('2024-01-01')).success, true);
    assert.equal(schema.safeParse('2024-01-01T00:00:00Z').success, false);
  });
});

describe('schemaToZod — v3→v4 characterization (number constraints)', () => {
  test('minimum and maximum bounds are inclusive', () => {
    const schema = schemaToZod(
      { type: 'number', minimum: 0, maximum: 10 },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse(0).success, true);
    assert.equal(schema.safeParse(10).success, true);
    assert.equal(schema.safeParse(-1).success, false);
    assert.equal(schema.safeParse(11).success, false);
  });

  test('exclusiveMinimum and exclusiveMaximum reject the boundary', () => {
    const schema = schemaToZod(
      { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse(0).success, false);
    assert.equal(schema.safeParse(10).success, false);
    assert.equal(schema.safeParse(0.0001).success, true);
    assert.equal(schema.safeParse(9.9999).success, true);
  });

  test('multipleOf rejects values that are not multiples', () => {
    const schema = schemaToZod({ type: 'number', multipleOf: 5 }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse(0).success, true);
    assert.equal(schema.safeParse(10).success, true);
    assert.equal(schema.safeParse(7).success, false);
  });

  test('type: integer rejects floats', () => {
    const schema = schemaToZod({ type: 'integer' }, ir, { required: true });
    assert.equal(schema.safeParse(42).success, true);
    assert.equal(schema.safeParse(3.14).success, false);
  });

  test('format: int32 enforces integer constraint on number type', () => {
    const schema = schemaToZod({ type: 'number', format: 'int32' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse(42).success, true);
    assert.equal(schema.safeParse(3.14).success, false);
  });

  test('format: int64 on an integer is a plain number', () => {
    const schema = schemaToZod({ type: 'integer', format: 'int64' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse(42).success, true);
    assert.equal(schema.safeParse(42n).success, false);
  });

  test('format: int64 with min/max bounds rejects out-of-range numbers', () => {
    const schema = schemaToZod(
      { type: 'integer', format: 'int64', minimum: 0, maximum: 10 },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse(0).success, true);
    assert.equal(schema.safeParse(10).success, true);
    assert.equal(schema.safeParse(-1).success, false);
    assert.equal(schema.safeParse(11).success, false);
  });
});

describe('schemaToZod — v3→v4 characterization (objects)', () => {
  test('additionalProperties: true allows unknown keys with any value', () => {
    const schema = schemaToZod(
      {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: true,
      },
      ir,
      { required: true },
    );
    const r = schema.safeParse({ id: 'x', extra: 123, more: { nested: true } });
    assert.equal(r.success, true);
    assert.deepEqual(r.data, {
      id: 'x',
      extra: 123,
      more: { nested: true },
    });
  });

  test('additionalProperties omitted strips unknown keys', () => {
    const schema = schemaToZod(
      {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      ir,
      { required: true },
    );
    const r = schema.safeParse({ id: 'x', extra: 'should-be-stripped' });
    assert.equal(r.success, true);
    assert.deepEqual(r.data, { id: 'x' });
  });

  test('additionalProperties as schema validates extra values', () => {
    const schema = schemaToZod(
      {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: { type: 'string' },
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse({ id: 'x', extra: 'allowed' }).success, true);
    assert.equal(schema.safeParse({ id: 'x', extra: 123 }).success, false);
  });

  test('object property marked required rejects missing key', () => {
    const schema = schemaToZod(
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
        },
        required: ['name'],
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse({ name: 'a' }).success, true);
    assert.equal(schema.safeParse({ name: 'a', age: 5 }).success, true);
    assert.equal(schema.safeParse({ age: 5 }).success, false);
  });
});

describe('schemaToZod — v3→v4 characterization (composition)', () => {
  test('allOf intersects required object schemas', () => {
    const schema = schemaToZod(
      {
        allOf: [
          {
            type: 'object',
            properties: { a: { type: 'string' } },
            required: ['a'],
          },
          {
            type: 'object',
            properties: { b: { type: 'number' } },
            required: ['b'],
          },
        ],
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse({ a: 'x', b: 1 }).success, true);
    assert.equal(schema.safeParse({ a: 'x' }).success, false);
    assert.equal(schema.safeParse({ b: 1 }).success, false);
  });

  test('anyOf accepts any matching branch', () => {
    const schema = schemaToZod(
      {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse('hi').success, true);
    assert.equal(schema.safeParse(42).success, true);
    assert.equal(schema.safeParse(true).success, false);
  });

  test('oneOf accepts a single matching branch', () => {
    const schema = schemaToZod(
      {
        oneOf: [{ type: 'string' }, { type: 'number' }],
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse('hi').success, true);
    assert.equal(schema.safeParse(42).success, true);
    assert.equal(schema.safeParse(true).success, false);
  });

  test('oneOf rejects values matching more than one branch (xor semantics)', () => {
    const schema = schemaToZod(
      {
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      },
      ir,
      { required: true },
    );
    // Both branches are open objects, so {} satisfies both — JSON Schema's
    // exclusive-or must reject it (z.union's anyOf semantics accepted it).
    assert.equal(schema.safeParse({}).success, false);
    assert.equal(schema.safeParse({ a: 'x', b: 1 }).success, false);
  });

  test('single-element anyOf returns the inner schema directly', () => {
    const schema = schemaToZod(
      {
        anyOf: [{ type: 'string' }],
      },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse('hi').success, true);
    assert.equal(schema.safeParse(42).success, false);
  });
});

describe('schemaToZod — v3→v4 characterization (enums)', () => {
  test('single-value enum becomes a literal', () => {
    const schema = schemaToZod({ type: 'string', enum: ['only'] }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('only').success, true);
    assert.equal(schema.safeParse('other').success, false);
  });

  test('two-value string enum accepts either value', () => {
    const schema = schemaToZod({ type: 'string', enum: ['asc', 'desc'] }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('asc').success, true);
    assert.equal(schema.safeParse('desc').success, true);
    assert.equal(schema.safeParse('other').success, false);
  });

  test('numeric enum typed "number" accepts its values', () => {
    const schema = schemaToZod({ type: 'number', enum: [1.5, 2.5] }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse(1.5).success, true);
    assert.equal(schema.safeParse(2.5).success, true);
    assert.equal(schema.safeParse(3).success, false);
  });

  test('numeric enum with no declared type accepts its values', () => {
    const schema = schemaToZod({ enum: [1, 2] }, ir, { required: true });
    assert.equal(schema.safeParse(1).success, true);
    assert.equal(schema.safeParse(2).success, true);
    assert.equal(schema.safeParse(3).success, false);
  });

  test('many-value string enum behaves as union of literals', () => {
    const schema = schemaToZod(
      { type: 'string', enum: ['a', 'b', 'c', 'd', 'e'] },
      ir,
      { required: true },
    );
    for (const v of ['a', 'b', 'c', 'd', 'e']) {
      assert.equal(schema.safeParse(v).success, true, `value ${v}`);
    }
    assert.equal(schema.safeParse('f').success, false);
  });

  test('integer enum accepts only listed integers', () => {
    const schema = schemaToZod({ type: 'integer', enum: [1, 2, 3] }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse(1).success, true);
    assert.equal(schema.safeParse(2).success, true);
    assert.equal(schema.safeParse(4).success, false);
    assert.equal(schema.safeParse('1').success, false);
  });

  test('enum with default returns undefined on undefined input (v3 .default().optional() semantics)', () => {
    const schema = schemaToZod(
      { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
      ir,
    );
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(
      r.data,
      undefined,
      'on zod v3, default is shadowed by trailing .optional() — output stays undefined',
    );
  });

  test('enum with default and required=true materializes default on undefined', () => {
    const schema = schemaToZod(
      { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
      ir,
      { required: true },
    );
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(r.data, 'asc');
  });
});

describe('schemaToZod — v3→v4 characterization (nullable)', () => {
  test('OpenAPI 3.0 nullable: true accepts null', () => {
    const schema = schemaToZod(
      { type: 'string', nullable: true } as Parameters<typeof schemaToZod>[0],
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse('hi').success, true);
    assert.equal(schema.safeParse(null).success, true);
    assert.equal(schema.safeParse(42).success, false);
  });

  test('OpenAPI 3.1 type: ["string","null"] accepts null', () => {
    const schema = schemaToZod(
      { type: ['string', 'null'] as unknown as 'string' },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse('hi').success, true);
    assert.equal(schema.safeParse(null).success, true);
    assert.equal(schema.safeParse(42).success, false);
  });

  test('default: null treats string as nullable', () => {
    const schema = schemaToZod({ type: 'string', default: null }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse(null).success, true);
    assert.equal(schema.safeParse('x').success, true);
  });
});

describe('schemaToZod — v3→v4 characterization (default + optional semantics)', () => {
  test('non-enum default + required=false materializes default (.optional().default() order)', () => {
    const schema = schemaToZod({ type: 'string', default: 'fallback' }, ir);
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(
      r.data,
      'fallback',
      'For plain types, wrapper builds .optional().default() — default fires on undefined in v3 and v4 alike.',
    );
  });

  test('default + required=true: parsing undefined yields the default', () => {
    const schema = schemaToZod({ type: 'string', default: 'fallback' }, ir, {
      required: true,
    });
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(r.data, 'fallback');
  });

  test('default + required=false: explicit value still validates', () => {
    const schema = schemaToZod({ type: 'string', default: 'fallback' }, ir);
    const r = schema.safeParse('explicit');
    assert.equal(r.success, true);
    assert.equal(r.data, 'explicit');
  });

  test('number default with required=true materializes', () => {
    const schema = schemaToZod({ type: 'number', default: 7 }, ir, {
      required: true,
    });
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(r.data, 7);
  });

  test('int64 default applies as a plain number', () => {
    const schema = schemaToZod(
      { type: 'integer', format: 'int64', default: 42 },
      ir,
      { required: true },
    );
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(r.data, 42);
  });
});

describe('schemaToZod — v3→v4 characterization (x-prefix transform)', () => {
  test('x-prefix prepends to required string input', () => {
    const schema = schemaToZod({ type: 'string', 'x-prefix': 'user_' }, ir, {
      required: true,
    });
    const r = schema.safeParse('123');
    assert.equal(r.success, true);
    assert.equal(r.data, 'user_123');
  });

  test('x-prefix on optional string returns undefined when input is undefined', () => {
    const schema = schemaToZod({ type: 'string', 'x-prefix': 'user_' }, ir);
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(r.data, undefined);
  });
});

describe('schemaToZod — v3→v4 characterization ($ref)', () => {
  test('$ref resolves and parses against the referenced schema', () => {
    const spec = {
      components: {
        schemas: {
          Id: { type: 'string', format: 'uuid' },
        },
      },
    } as never;
    const schema = schemaToZod({ $ref: '#/components/schemas/Id' }, spec, {
      required: true,
    });
    assert.equal(
      schema.safeParse('550e8400-e29b-41d4-a716-446655440000').success,
      true,
    );
    assert.equal(schema.safeParse('not-a-uuid').success, false);
  });

  test('nested $ref inside object property validates the referenced shape', () => {
    const spec = {
      components: {
        schemas: {
          Email: { type: 'string', format: 'email' },
        },
      },
    } as never;
    const schema = schemaToZod(
      {
        type: 'object',
        required: ['contact'],
        properties: {
          contact: { $ref: '#/components/schemas/Email' },
        },
      },
      spec,
      { required: true },
    );
    assert.equal(schema.safeParse({ contact: 'a@b.com' }).success, true);
    assert.equal(schema.safeParse({ contact: 'not-an-email' }).success, false);
  });

  test('$ref with non-required wraps result in optional', () => {
    const spec = {
      components: {
        schemas: { Name: { type: 'string' } },
      },
    } as never;
    const schema = schemaToZod({ $ref: '#/components/schemas/Name' }, spec);
    assert.equal(schema.safeParse(undefined).success, true);
    assert.equal(schema.safeParse('hi').success, true);
  });
});

describe('schemaToZod — v3→v4 characterization (arrays)', () => {
  test('array of string rejects elements of the wrong type', () => {
    const schema = schemaToZod(
      { type: 'array', items: { type: 'string' } },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse(['a', 'b']).success, true);
    assert.equal(schema.safeParse(['a', 1]).success, false);
    assert.equal(schema.safeParse('not-an-array').success, false);
  });

  test('array default applies when required=true and input is undefined', () => {
    const schema = schemaToZod(
      {
        type: 'array',
        items: { type: 'string' },
        default: ['x'],
      },
      ir,
      { required: true },
    );
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.deepEqual(r.data, ['x']);
  });

  test('array without items accepts any element', () => {
    const schema = schemaToZod({ type: 'array' }, ir, { required: true });
    assert.equal(schema.safeParse([1, 'a', { x: true }]).success, true);
  });
});

describe('schemaToZod — v3→v4 characterization (assorted)', () => {
  test('boolean type rejects strings without coerce marker', () => {
    const schema = schemaToZod({ type: 'boolean' }, ir, { required: true });
    assert.equal(schema.safeParse(true).success, true);
    assert.equal(schema.safeParse(false).success, true);
    assert.equal(schema.safeParse('true').success, false);
  });

  test('object property without required flag is optional (undefined passes)', () => {
    const schema = schemaToZod(
      {
        type: 'object',
        properties: { age: { type: 'integer' } },
      },
      ir,
      { required: true },
    );
    const shape = (schema as unknown as { shape: Record<string, ZodType> })
      .shape;
    assert.equal(shape.age.safeParse(undefined).success, true);
    assert.equal(shape.age.safeParse(5).success, true);
    assert.equal(shape.age.safeParse('5').success, false);
  });

  test('union of multiple non-null types accepts any branch', () => {
    const schema = schemaToZod(
      { type: ['string', 'number'] as unknown as 'string' },
      ir,
      { required: true },
    );
    assert.equal(schema.safeParse('a').success, true);
    assert.equal(schema.safeParse(1).success, true);
    assert.equal(schema.safeParse(true).success, false);
  });
});

describe('schemaToZod — coerce-string composes with formats (v3 parity)', () => {
  test('coerce-string + email coerces stringifiable input before validating', () => {
    const schema = schemaToZod(
      { type: 'string', format: 'email', 'x-zod-type': 'coerce-string' },
      ir,
      { required: true },
    );
    const stringifiable = { toString: () => 'a@b.com' };
    const result = schema.safeParse(stringifiable);
    assert.equal(result.success, true);
    assert.equal(result.data, 'a@b.com');
  });

  test('email format without coerce marker still rejects non-string input', () => {
    const schema = schemaToZod({ type: 'string', format: 'email' }, ir, {
      required: true,
    });
    assert.equal(
      schema.safeParse({ toString: () => 'a@b.com' }).success,
      false,
    );
    assert.equal(schema.safeParse('a@b.com').success, true);
  });
});

describe('schemaToZod — cidr formats use semantic validators', () => {
  test('format: cidrv4 validates CIDR notation', () => {
    const schema = schemaToZod({ type: 'string', format: 'cidrv4' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('192.168.0.0/24').success, true);
    assert.equal(schema.safeParse('192.168.0.0').success, false);
    assert.equal(schema.safeParse('not-a-cidr').success, false);
  });

  test('format: cidrv6 validates IPv6 CIDR notation', () => {
    const schema = schemaToZod({ type: 'string', format: 'cidrv6' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse('2001:db8::/32').success, true);
    assert.equal(schema.safeParse('2001:db8::1').success, false);
  });
});

describe('schemaToZod — binary content is a cross-runtime passthrough', () => {
  test('binary format accepts Blob/File and any other body value', () => {
    // Deliberately bare z.custom<Blob>(): referencing Blob as a runtime
    // value throws ReferenceError where the global is missing, and
    // cross-realm/polyfill Blobs and Buffers fail instanceof checks
    // (see e62c4e1, docs/recipes/file-upload.md). Bad inputs surface in
    // fetch/FormData instead of client-side validation.
    const schema = schemaToZod({ type: 'string', format: 'binary' }, ir, {
      required: true,
    });
    assert.equal(schema.safeParse(new Blob(['x'])).success, true);
    assert.equal(
      schema.safeParse(new File(['x'], 'x.txt')).success,
      true,
      'File extends Blob',
    );
    assert.equal(
      schema.safeParse(Buffer.from('x')).success,
      true,
      'Buffer and polyfill Blobs must not be rejected client-side',
    );
    assert.equal(schema.safeParse('a-string').success, true);
  });
});
