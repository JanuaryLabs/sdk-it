import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evalZod } from '@sdk-it/core';

describe('evalZod characterization (v3 baseline that v4 migration must preserve)', () => {
  describe('z.string() format keywords', () => {
    test('z.string().email() emits format: "email"', async () => {
      const { schema, optional } = await evalZod('z.string().email()');
      assert.equal(optional, false);
      assert.deepStrictEqual(schema, { type: 'string', format: 'email' });
    });

    test('z.string().url() emits format: "uri"', async () => {
      const { schema } = await evalZod('z.string().url()');
      assert.deepStrictEqual(schema, { type: 'string', format: 'uri' });
    });

    test('z.string().uuid() emits format: "uuid"', async () => {
      const { schema } = await evalZod('z.string().uuid()');
      assert.deepStrictEqual(schema, { type: 'string', format: 'uuid' });
    });

    test('z.string().datetime() emits format: "date-time"', async () => {
      const { schema } = await evalZod('z.string().datetime()');
      assert.deepStrictEqual(schema, { type: 'string', format: 'date-time' });
    });

    test('z.string().date() emits format: "date"', async () => {
      const { schema } = await evalZod('z.string().date()');
      assert.deepStrictEqual(schema, { type: 'string', format: 'date' });
    });

    test('z.string().ip({ version: "v4" }) emits format: "ipv4"', async () => {
      const { schema } = await evalZod('z.string().ip({ version: "v4" })');
      assert.deepStrictEqual(schema, { type: 'string', format: 'ipv4' });
    });

    test('z.string().ip({ version: "v6" }) emits format: "ipv6"', async () => {
      const { schema } = await evalZod('z.string().ip({ version: "v6" })');
      assert.deepStrictEqual(schema, { type: 'string', format: 'ipv6' });
    });

    test('z.string().min(2).max(8) emits minLength and maxLength', async () => {
      const { schema } = await evalZod('z.string().min(2).max(8)');
      assert.deepStrictEqual(schema, {
        type: 'string',
        minLength: 2,
        maxLength: 8,
      });
    });

    test('z.string().regex(/^a+$/) emits pattern', async () => {
      const { schema } = await evalZod('z.string().regex(/^a+$/)');
      assert.deepStrictEqual(schema, { type: 'string', pattern: '^a+$' });
    });
  });

  describe('z.number() numeric constraints', () => {
    test('z.number().min(0).max(10) emits minimum and maximum', async () => {
      const { schema } = await evalZod('z.number().min(0).max(10)');
      assert.deepStrictEqual(schema, {
        type: 'number',
        minimum: 0,
        maximum: 10,
      });
    });

    test('z.number().int().gt(0).lt(100).multipleOf(2) emits integer with exclusive bounds and multipleOf', async () => {
      const { schema } = await evalZod(
        'z.number().int().gt(0).lt(100).multipleOf(2)',
      );
      assert.deepStrictEqual(schema, {
        type: 'integer',
        exclusiveMinimum: 0,
        exclusiveMaximum: 100,
        multipleOf: 2,
      });
    });
  });

  describe('z.object() shape variants', () => {
    test('catchall(z.unknown()) emits additionalProperties: {}', async () => {
      const { schema } = await evalZod(
        'z.object({ a: z.string() }).catchall(z.unknown())',
      );
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: {},
      });
    });

    test('.strict() emits additionalProperties: false', async () => {
      const { schema } = await evalZod('z.object({ a: z.string() }).strict()');
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      });
    });

    test('plain object emits additionalProperties: false and a required array', async () => {
      const { schema } = await evalZod('z.object({ a: z.string() })');
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      });
    });

    test('nested objects emit deeply nested properties with their own required arrays', async () => {
      const { schema } = await evalZod(
        'z.object({ outer: z.object({ inner: z.number() }) })',
      );
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: { inner: { type: 'number' } },
            required: ['inner'],
            additionalProperties: false,
          },
        },
        required: ['outer'],
        additionalProperties: false,
      });
    });

    test('an optional field is omitted from the required array', async () => {
      const { schema } = await evalZod(
        'z.object({ a: z.string(), b: z.number().optional() })',
      );
      assert.deepStrictEqual(schema.required, ['a']);
      assert.deepStrictEqual(schema.properties.b, { type: 'number' });
    });
  });

  describe('unions, literals, enums', () => {
    test('z.union of primitives collapses to a multi-type array (not anyOf)', async () => {
      const { schema } = await evalZod('z.union([z.string(), z.number()])');
      assert.deepStrictEqual(schema, { type: ['string', 'number'] });
    });

    test('z.literal("hello") emits string type with const', async () => {
      const { schema } = await evalZod('z.literal("hello")');
      assert.deepStrictEqual(schema, { type: 'string', const: 'hello' });
    });

    test('z.literal(42) emits number type with const', async () => {
      const { schema } = await evalZod('z.literal(42)');
      assert.deepStrictEqual(schema, { type: 'number', const: 42 });
    });

    test('z.enum of strings emits string type with enum array', async () => {
      const { schema } = await evalZod('z.enum(["red", "green", "blue"])');
      assert.deepStrictEqual(schema, {
        type: 'string',
        enum: ['red', 'green', 'blue'],
      });
    });

    test('z.discriminatedUnion emits anyOf of object branches', async () => {
      const { schema } = await evalZod(
        'z.discriminatedUnion("kind", [z.object({ kind: z.literal("a"), a: z.string() }), z.object({ kind: z.literal("b"), b: z.number() })])',
      );
      assert.deepStrictEqual(schema, {
        anyOf: [
          {
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'a' },
              a: { type: 'string' },
            },
            required: ['kind', 'a'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'b' },
              b: { type: 'number' },
            },
            required: ['kind', 'b'],
            additionalProperties: false,
          },
        ],
      });
    });
  });

  describe('arrays and tuples', () => {
    test('z.array(z.string()).min(1).max(10) emits items, minItems, maxItems', async () => {
      const { schema } = await evalZod('z.array(z.string()).min(1).max(10)');
      assert.deepStrictEqual(schema, {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
      });
    });

    test('z.array(z.enum(...)) preserves enum on items', async () => {
      const { schema } = await evalZod('z.array(z.enum(["a","b"])).min(1)');
      assert.deepStrictEqual(schema, {
        type: 'array',
        items: { type: 'string', enum: ['a', 'b'] },
        minItems: 1,
      });
    });

    test('z.tuple emits array with positional items and bounded length', async () => {
      const { schema } = await evalZod('z.tuple([z.string(), z.number()])');
      assert.deepStrictEqual(schema, {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: [{ type: 'string' }, { type: 'number' }],
      });
    });
  });

  describe('refinements and transforms (effectStrategy: input)', () => {
    test('.refine() with custom message drops to bare type', async () => {
      const { schema, optional } = await evalZod(
        'z.string().refine((v) => v.length > 3, { message: "too short" })',
      );
      assert.equal(optional, false);
      assert.deepStrictEqual(schema, { type: 'string' });
    });

    test('.transform() on z.string() drops to bare string type', async () => {
      const { schema } = await evalZod(
        'z.string().transform((s) => s.toUpperCase())',
      );
      assert.deepStrictEqual(schema, { type: 'string' });
    });

    test('.transform() on z.number() drops to bare number type', async () => {
      const { schema } = await evalZod('z.number().transform((n) => n + 1)');
      assert.deepStrictEqual(schema, { type: 'number' });
    });

    test('.transform() on z.boolean() drops to bare boolean type', async () => {
      const { schema } = await evalZod('z.boolean().transform((b) => !b)');
      assert.deepStrictEqual(schema, { type: 'boolean' });
    });
  });

  describe('coerce.bigint edge cases', () => {
    test('z.coerce.bigint() without default emits int64 with x-zod-type marker', async () => {
      const { schema, optional } = await evalZod('z.coerce.bigint()');
      assert.equal(optional, false);
      assert.deepStrictEqual(schema, {
        type: 'integer',
        format: 'int64',
        'x-zod-type': 'coerce-bigint',
      });
    });

    test('z.coerce.bigint().default(1n) lands the default in the spec as a plain number', async () => {
      const { schema } = await evalZod('z.coerce.bigint().default(1n)');
      assert.equal(schema.type, 'integer');
      assert.equal(schema.format, 'int64');
      assert.equal(schema['x-zod-type'], 'coerce-bigint');
      assert.equal(typeof schema.default, 'number');
      assert.equal(schema.default, 1);
    });
  });

  describe('records, nullable, any/unknown, null', () => {
    test('z.record(z.string(), z.number()) emits object with additionalProperties schema', async () => {
      const { schema } = await evalZod('z.record(z.string(), z.number())');
      assert.deepStrictEqual(schema, {
        type: 'object',
        additionalProperties: { type: 'number' },
      });
    });

    test('z.nullable(z.string()) emits multi-type ["string","null"]', async () => {
      const { schema } = await evalZod('z.nullable(z.string())');
      assert.deepStrictEqual(schema, { type: ['string', 'null'] });
    });

    test('z.null() emits type: "null"', async () => {
      const { schema } = await evalZod('z.null()');
      assert.deepStrictEqual(schema, { type: 'null' });
    });

    test('z.any() emits empty schema', async () => {
      const { schema } = await evalZod('z.any()');
      assert.deepStrictEqual(schema, {});
    });

    test('z.unknown() emits empty schema', async () => {
      const { schema } = await evalZod('z.unknown()');
      assert.deepStrictEqual(schema, {});
    });
  });

  describe('intersections', () => {
    test('z.intersection members stay open (no additionalProperties) so allOf remains satisfiable', async () => {
      const { schema } = await evalZod(
        'z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))',
      );
      assert.equal(schema.allOf.length, 2);
      for (const member of schema.allOf) {
        assert.equal(
          member.additionalProperties,
          undefined,
          'allOf member must not forbid sibling properties',
        );
      }
      assert.deepStrictEqual(schema.allOf[0].properties, {
        a: { type: 'string' },
      });
      assert.deepStrictEqual(schema.allOf[1].properties, {
        b: { type: 'number' },
      });
    });
  });

  describe('zod v3 methods removed in v4 (analyzed user source keeps working)', () => {
    test('bare z.string().ip() emits an anyOf of ipv4/ipv6 formats', async () => {
      const { schema } = await evalZod('z.string().ip()');
      assert.deepStrictEqual(schema.anyOf, [
        { type: 'string', format: 'ipv4' },
        { type: 'string', format: 'ipv6' },
      ]);
    });

    test('z.string().ip({ version }) emits the single format', async () => {
      const v4 = await evalZod("z.string().ip({ version: 'v4' })");
      assert.deepStrictEqual(v4.schema, { type: 'string', format: 'ipv4' });
      const v6 = await evalZod("z.string().ip({ version: 'v6' })");
      assert.deepStrictEqual(v6.schema, { type: 'string', format: 'ipv6' });
    });

    test('z.string().cidr() converts instead of crashing', async () => {
      const { schema } = await evalZod('z.string().cidr()');
      assert.equal(schema.anyOf.length, 2);
      const v4 = await evalZod("z.string().cidr({ version: 'v4' })");
      assert.equal(v4.schema.type, 'string');
    });

    test('cidr keeps both format (for sdk-it converters) and pattern (for third-party validators)', async () => {
      const { schema } = await evalZod("z.string().cidr({ version: 'v4' })");
      assert.equal(schema.format, 'cidrv4');
      assert.ok(
        schema.pattern,
        'pattern retained for consumers without cidrv4 support',
      );
      assert.ok(new RegExp(schema.pattern).test('192.168.0.0/24'));
    });
  });

  describe('.catch() fallbacks', () => {
    test('z.string().catch() does not leak the fallback as a spec default', async () => {
      const { schema } = await evalZod("z.string().catch('fallback')");
      assert.deepStrictEqual(schema, { type: 'string' });
    });

    test('z.bigint().catch() converts instead of crashing on bigint serialization', async () => {
      const { schema } = await evalZod('z.bigint().catch(5n)');
      assert.deepStrictEqual(schema, { type: 'integer', format: 'int64' });
    });

    test('a bigint default behind z.lazy still masks and lands as a plain number', async () => {
      const { schema } = await evalZod(
        'z.object({ n: z.lazy(() => z.bigint().default(1n)) })',
      );
      assert.equal(schema.properties.n.format, 'int64');
      assert.equal(schema.properties.n.default, 1);
    });
  });

  describe('recursive schemas', () => {
    test('non-root recursion inlines the cycle and emits component-relative refs (no definitions block)', async () => {
      const { schema } = await evalZod(
        `z.object({
          leaf: (() => {
            const leaf = z.object({
              v: z.string(),
              next: z.lazy(() => leaf).optional(),
            });
            return leaf;
          })(),
        })`,
      );
      assert.equal(
        schema.definitions,
        undefined,
        'no draft-7 definitions block',
      );
      const leaf = schema.properties.leaf;
      assert.equal(leaf.type, 'object', 'first use site is inlined');
      assert.deepStrictEqual(leaf.properties.v, { type: 'string' });
      assert.equal(
        leaf.properties.next.$ref,
        '#/components/schemas/properties/leaf',
        'recursive ref points structurally at the inlined site',
      );
    });
  });

  describe('sets and maps', () => {
    test('z.set() emits a unique-items array schema', async () => {
      const { schema } = await evalZod('z.set(z.string())');
      assert.deepStrictEqual(schema, {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string' },
      });
    });

    test('z.map() emits an array-of-entry-pairs schema', async () => {
      const { schema } = await evalZod('z.map(z.string(), z.number())');
      assert.equal(schema.type, 'array');
      assert.deepStrictEqual(schema.items.items, [
        { type: 'string' },
        { type: 'number' },
      ]);
      assert.equal(schema.items.minItems, 2);
      assert.equal(schema.items.maxItems, 2);
    });
  });

  describe('nonstandard string formats keep their pattern', () => {
    test('z.string().cuid() emits a validating pattern, not a bare nonstandard format keyword', async () => {
      const { schema } = await evalZod('z.string().cuid()');
      assert.equal(schema.type, 'string');
      assert.equal(schema.format, undefined, 'no nonstandard format keyword');
      assert.ok(schema.pattern, 'pattern preserved');
      const re = new RegExp(schema.pattern);
      assert.ok(re.test('cjld2cjxh0000qzrmn831i7rn'), 'accepts a real cuid');
      assert.ok(!re.test('nope!'), 'rejects junk');
    });

    test('z.string().ulid() and .emoji() keep their patterns too', async () => {
      const ulid = await evalZod('z.string().ulid()');
      assert.ok(ulid.schema.pattern, 'ulid pattern preserved');
      assert.ok(
        new RegExp(ulid.schema.pattern).test('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
      );
      const emoji = await evalZod('z.string().emoji()');
      assert.ok(emoji.schema.pattern, 'emoji pattern preserved');
    });
  });

  describe('safe-integer bounds', () => {
    test('implicit z.int() safe-integer bounds are stripped', async () => {
      const { schema } = await evalZod('z.number().int()');
      assert.equal(schema.maximum, undefined);
      assert.equal(schema.minimum, undefined);
    });

    test('an explicit .max(MAX_SAFE_INTEGER) declared by the author is preserved', async () => {
      const { schema } = await evalZod(
        'z.number().int().max(9007199254740991)',
      );
      assert.equal(schema.maximum, 9007199254740991);
    });

    test('an explicit .min(MIN_SAFE_INTEGER) declared by the author is preserved', async () => {
      const { schema } = await evalZod(
        'z.number().int().min(-9007199254740991)',
      );
      assert.equal(schema.minimum, -9007199254740991);
    });
  });

  describe('optional flag tracking', () => {
    test('a top-level .optional() sets optional: true', async () => {
      const { optional, schema } = await evalZod('z.string().optional()');
      assert.equal(optional, true);
      assert.equal(schema.type, 'string');
    });

    test('a required schema sets optional: false', async () => {
      const { optional } = await evalZod('z.string()');
      assert.equal(optional, false);
    });

    test('a top-level .nullish() sets optional: true and adds null branch', async () => {
      const { optional, schema } = await evalZod('z.string().nullish()');
      assert.equal(optional, true);
      assert.ok(Array.isArray(schema.anyOf) || Array.isArray(schema.type));
    });

    test('a nested optional inside an object still flips optional to true (override fires on any ZodOptional)', async () => {
      const { optional, schema } = await evalZod(
        'z.object({ a: z.string().optional() })',
      );
      assert.equal(optional, true);
      assert.equal(schema.type, 'object');
      assert.deepStrictEqual(schema.properties.a, { type: 'string' });
      assert.deepStrictEqual(schema.required ?? [], []);
    });
  });
});
