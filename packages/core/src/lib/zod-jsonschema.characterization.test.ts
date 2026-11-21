import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as z from 'zod';

import { ZodEvaluator } from '@sdk-it/core';

/** zod's own JSON Schema for `schema`, which the evaluator writes as is. */
function zodsOwn(schema: z.ZodType) {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, {
    io: 'input',
  });
  return json;
}

/** The value at `keys` below a converted JSON Schema node. */
function at(node: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null
        ? Reflect.get(value, key)
        : undefined,
    node,
  );
}

describe("ZodEvaluator writes zod's JSON Schema", () => {
  describe('z.string() format keywords', () => {
    test('z.string().email() emits format: "email" with zod\'s pattern', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema, optional } =
        await evaluator.evaluate('z.string().email()');
      assert.equal(optional, false);
      assert.deepStrictEqual(schema, zodsOwn(z.email()));
    });

    test('z.string().url() emits format: "uri"', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.string().url()');
      assert.deepStrictEqual(schema, { type: 'string', format: 'uri' });
    });

    test('z.string().uuid() emits format: "uuid" with zod\'s pattern', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.string().uuid()');
      assert.deepStrictEqual(schema, zodsOwn(z.uuid()));
    });

    test('z.string().datetime() emits format: "date-time" with zod\'s pattern', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.string().datetime()');
      assert.deepStrictEqual(schema, zodsOwn(z.iso.datetime()));
    });

    test('z.string().date() emits format: "date" with zod\'s pattern', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.string().date()');
      assert.deepStrictEqual(schema, zodsOwn(z.iso.date()));
    });

    test('z.ipv4() emits format: "ipv4" with zod\'s pattern', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.ipv4()');
      assert.deepStrictEqual(schema, zodsOwn(z.ipv4()));
    });

    test('z.ipv6() emits format: "ipv6" with zod\'s pattern', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.ipv6()');
      assert.deepStrictEqual(schema, zodsOwn(z.ipv6()));
    });

    test('z.string().min(2).max(8) emits minLength and maxLength', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.string().min(2).max(8)');
      assert.deepStrictEqual(schema, {
        type: 'string',
        minLength: 2,
        maxLength: 8,
      });
    });

    test('z.string().regex(/^a+$/) emits pattern', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.string().regex(/^a+$/)');
      assert.deepStrictEqual(schema, { type: 'string', pattern: '^a+$' });
    });
  });

  describe('z.number() numeric constraints', () => {
    test('z.number().min(0).max(10) emits minimum and maximum', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.number().min(0).max(10)');
      assert.deepStrictEqual(schema, {
        type: 'number',
        minimum: 0,
        maximum: 10,
      });
    });

    test('z.number().int().gt(0).lt(100).multipleOf(2) emits integer with exclusive bounds and multipleOf', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
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
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
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
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.object({ a: z.string() }).strict()',
      );
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      });
    });

    test('plain object emits a required array and leaves unknown keys open, as zod strips them', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.object({ a: z.string() })',
      );
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      });
    });

    test('nested objects emit deeply nested properties with their own required arrays', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.object({ outer: z.object({ inner: z.number() }) })',
      );
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: { inner: { type: 'number' } },
            required: ['inner'],
          },
        },
        required: ['outer'],
      });
    });

    test('an optional field is omitted from the required array', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.object({ a: z.string(), b: z.number().optional() })',
      );
      assert.deepStrictEqual(schema.required, ['a']);
      assert.deepStrictEqual(at(schema, 'properties', 'b'), { type: 'number' });
    });
  });

  describe('unions, literals, enums', () => {
    test('z.union of primitives collapses to a multi-type array (not anyOf)', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.union([z.string(), z.number()])',
      );
      assert.deepStrictEqual(schema, { type: ['string', 'number'] });
    });

    test('z.literal("hello") emits string type with const', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.literal("hello")');
      assert.deepStrictEqual(schema, { type: 'string', const: 'hello' });
    });

    test('z.literal(42) emits number type with const', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.literal(42)');
      assert.deepStrictEqual(schema, { type: 'number', const: 42 });
    });

    test('z.enum of strings emits string type with enum array', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.enum(["red", "green", "blue"])',
      );
      assert.deepStrictEqual(schema, {
        type: 'string',
        enum: ['red', 'green', 'blue'],
      });
    });

    test('z.discriminatedUnion emits oneOf of object branches with its discriminator', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.discriminatedUnion("kind", [z.object({ kind: z.literal("a"), a: z.string() }), z.object({ kind: z.literal("b"), b: z.number() })])',
      );
      assert.deepStrictEqual(schema, {
        discriminator: { propertyName: 'kind' },
        oneOf: [
          {
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'a' },
              a: { type: 'string' },
            },
            required: ['kind', 'a'],
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'b' },
              b: { type: 'number' },
            },
            required: ['kind', 'b'],
          },
        ],
      });
    });
  });

  describe('arrays and tuples', () => {
    test('z.array(z.string()).min(1).max(10) emits items, minItems, maxItems', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.array(z.string()).min(1).max(10)',
      );
      assert.deepStrictEqual(schema, {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
      });
    });

    test('z.array(z.enum(...)) preserves enum on items', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.array(z.enum(["a","b"])).min(1)',
      );
      assert.deepStrictEqual(schema, {
        type: 'array',
        items: { type: 'string', enum: ['a', 'b'] },
        minItems: 1,
      });
    });

    test('z.tuple emits a closed array with prefixItems and bounded length', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.tuple([z.string(), z.number()])',
      );
      assert.deepStrictEqual(schema, {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        items: false,
      });
    });

    test('z.tuple with a rest emits prefixItems and the rest as items', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.tuple([z.string()], z.number())',
      );
      assert.deepStrictEqual(schema, {
        type: 'array',
        minItems: 1,
        prefixItems: [{ type: 'string' }],
        items: { type: 'number' },
      });
    });
  });

  describe('refinements and transforms (effectStrategy: input)', () => {
    test('.refine() with custom message drops to bare type', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema, optional } = await evaluator.evaluate(
        'z.string().refine((v) => v.length > 3, { message: "too short" })',
      );
      assert.equal(optional, false);
      assert.deepStrictEqual(schema, { type: 'string' });
    });

    test('.transform() on z.string() drops to bare string type', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.string().transform((s) => s.toUpperCase())',
      );
      assert.deepStrictEqual(schema, { type: 'string' });
    });

    test('.transform() on z.number() drops to bare number type', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.number().transform((n) => n + 1)',
      );
      assert.deepStrictEqual(schema, { type: 'number' });
    });

    test('.transform() on z.boolean() drops to bare boolean type', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.boolean().transform((b) => !b)',
      );
      assert.deepStrictEqual(schema, { type: 'boolean' });
    });
  });

  describe('coerce.bigint edge cases', () => {
    test('z.coerce.bigint() without default emits int64 with x-zod-type marker', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema, optional } =
        await evaluator.evaluate('z.coerce.bigint()');
      assert.equal(optional, false);
      assert.deepStrictEqual(schema, {
        type: 'integer',
        format: 'int64',
        'x-zod-type': 'coerce-bigint',
      });
    });

    test('z.coerce.bigint().default(1n) lands the default in the spec as a plain number', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.coerce.bigint().default(1n)',
      );
      assert.equal(schema.type, 'integer');
      assert.equal(schema.format, 'int64');
      assert.equal(schema['x-zod-type'], 'coerce-bigint');
      assert.equal(typeof schema.default, 'number');
      assert.equal(schema.default, 1);
    });
  });

  describe('records, nullable, any/unknown, null', () => {
    test('z.record(z.string(), z.number()) emits object with additionalProperties schema', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.record(z.string(), z.number())',
      );
      assert.deepStrictEqual(schema, {
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: { type: 'number' },
      });
    });

    test('z.nullable(z.string()) emits multi-type ["string","null"]', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.nullable(z.string())');
      assert.deepStrictEqual(schema, { type: ['string', 'null'] });
    });

    test('z.null() emits type: "null"', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.null()');
      assert.deepStrictEqual(schema, { type: 'null' });
    });

    test('z.any() emits empty schema', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.any()');
      assert.deepStrictEqual(schema, {});
    });

    test('z.unknown() emits empty schema', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.unknown()');
      assert.deepStrictEqual(schema, {});
    });
  });

  describe('intersections', () => {
    test("z.intersection of two objects is one satisfiable object holding both members' fields", async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))',
      );
      assert.deepStrictEqual(schema, {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a', 'b'],
      });
    });
  });

  describe('cidr formats', () => {
    test('cidr keeps both format (for sdk-it converters) and pattern (for third-party validators)', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.cidrv4()');
      assert.equal(schema.format, 'cidrv4');
      assert.ok(
        schema.pattern,
        'pattern retained for consumers without cidrv4 support',
      );
      assert.ok(new RegExp(String(schema.pattern)).test('192.168.0.0/24'));
    });
  });

  describe('.catch() fallbacks', () => {
    test('z.string().catch() writes its fallback as the default', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        "z.string().catch('fallback')",
      );
      assert.deepStrictEqual(schema, { default: 'fallback', type: 'string' });
    });

    test('z.bigint().catch() converts instead of crashing on bigint serialization', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.bigint().catch(5n)');
      assert.deepStrictEqual(schema, {
        default: 5,
        type: 'integer',
        format: 'int64',
      });
    });

    test('a bigint default behind z.lazy still masks and lands as a plain number', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.object({ n: z.lazy(() => z.bigint().default(1n)) })',
      );
      assert.equal(at(schema, 'properties', 'n', 'format'), 'int64');
      assert.equal(at(schema, 'properties', 'n', 'default'), 1);
    });
  });

  describe('recursive schemas', () => {
    test('root recursion without a name is refused with how to name it', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      await assert.rejects(
        evaluator.evaluate('z.json()'),
        /\.meta\(\{ id \}\)/,
      );
    });

    test('non-root recursion without a name is refused with how to name it', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      await assert.rejects(
        evaluator.evaluate(
          `z.object({
          leaf: (() => {
            const leaf = z.object({
              v: z.string(),
              next: z.lazy(() => leaf).optional(),
            });
            return leaf;
          })(),
        })`,
        ),
        /\.meta\(\{ id \}\)/,
      );
    });

    test('named non-root recursion becomes a component that its recursive field points at (no definitions block)', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema, components } = await evaluator.evaluate(
        `z.object({
          leaf: (() => {
            const leaf = z.object({
              v: z.string(),
              next: z.lazy(() => leaf).optional(),
            }).meta({ id: 'Leaf' });
            return leaf;
          })(),
        })`,
      );
      assert.equal(
        schema.definitions,
        undefined,
        'no draft-7 definitions block',
      );
      assert.equal(
        at(schema, 'properties', 'leaf', '$ref'),
        '#/components/schemas/Leaf',
      );
      assert.deepStrictEqual(at(components, 'Leaf', 'properties', 'v'), {
        type: 'string',
      });
      assert.equal(
        at(components, 'Leaf', 'properties', 'next', '$ref'),
        '#/components/schemas/Leaf',
        'the recursive ref points at the component',
      );
    });
  });

  describe('sets and maps', () => {
    test('z.set() emits a unique-items array schema', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.set(z.string())');
      assert.deepStrictEqual(schema, {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string' },
      });
    });

    test('z.map() emits an array-of-entry-pairs schema', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.map(z.string(), z.number())',
      );
      assert.deepStrictEqual(schema, {
        type: 'array',
        items: {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'number' }],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
      });
    });

    test('a self-reference that carries a description keeps it beside its $ref', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema, components } = await evaluator.evaluate(
        `(() => {
          const node = z.object({
            get next() { return node.optional().describe('the next node'); },
          }).meta({ id: 'Node' });
          return node;
        })()`,
      );
      assert.deepStrictEqual(schema, { $ref: '#/components/schemas/Node' });
      assert.deepStrictEqual(components, {
        Node: {
          type: 'object',
          properties: {
            next: {
              description: 'the next node',
              $ref: '#/components/schemas/Node',
            },
          },
        },
      });
    });

    test('a named recursive schema reached only through z.set() becomes the component its items point at', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema, components } = await evaluator.evaluate(
        `(() => {
          const tree = z.object({
            v: z.string(),
            get kids() { return z.array(tree); },
          }).meta({ id: 'Tree' });
          return z.set(tree);
        })()`,
      );
      assert.deepStrictEqual(schema, {
        type: 'array',
        uniqueItems: true,
        items: { $ref: '#/components/schemas/Tree' },
      });
      assert.deepStrictEqual(components, {
        Tree: {
          type: 'object',
          properties: {
            v: { type: 'string' },
            kids: {
              type: 'array',
              items: { $ref: '#/components/schemas/Tree' },
            },
          },
          required: ['v', 'kids'],
        },
      });
    });

    test('a named schema reached only through a pipe output becomes the component the pipe points at', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema, components } = await evaluator.evaluate(
        "z.string().pipe(z.string().max(3).meta({ id: 'Code' }))",
      );
      assert.deepStrictEqual(schema, {
        allOf: [{ type: 'string' }, { $ref: '#/components/schemas/Code' }],
      });
      assert.deepStrictEqual(components, {
        Code: { type: 'string', maxLength: 3 },
      });
    });

    test('two different schemas with one id inside two sets fail with how to fix it', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      await assert.rejects(
        evaluator.evaluate(
          "z.object({ a: z.set(z.string().meta({ id: 'Name' })), b: z.set(z.number().meta({ id: 'Name' })) })",
        ),
        /Two different schemas share the id "Name"; give each its own \.meta\(\{ id \}\)/,
      );
    });
  });

  describe('nonstandard string formats keep their pattern', () => {
    test('z.string().cuid() emits a validating pattern beside its format', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.string().cuid()');
      assert.equal(schema.type, 'string');
      assert.equal(schema.format, 'cuid');
      assert.ok(schema.pattern, 'pattern preserved');
      const re = new RegExp(String(schema.pattern));
      assert.ok(re.test('cjld2cjxh0000qzrmn831i7rn'), 'accepts a real cuid');
      assert.ok(!re.test('nope!'), 'rejects junk');
    });

    test('z.string().ulid() and .emoji() keep their patterns too', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const ulid = await evaluator.evaluate('z.string().ulid()');
      assert.ok(ulid.schema.pattern, 'ulid pattern preserved');
      assert.ok(
        new RegExp(String(ulid.schema.pattern)).test(
          '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ),
      );
      const emoji = await evaluator.evaluate('z.string().emoji()');
      assert.ok(emoji.schema.pattern, 'emoji pattern preserved');
    });
  });

  describe('safe-integer bounds', () => {
    test('z.int() writes the safe-integer bounds it checks', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate('z.number().int()');
      assert.deepStrictEqual(schema, {
        type: 'integer',
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      });
    });

    test('an explicit .max(MAX_SAFE_INTEGER) declared by the author is preserved', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.number().int().max(9007199254740991)',
      );
      assert.equal(schema.maximum, 9007199254740991);
    });

    test('an explicit .min(MIN_SAFE_INTEGER) declared by the author is preserved', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { schema } = await evaluator.evaluate(
        'z.number().int().min(-9007199254740991)',
      );
      assert.equal(schema.minimum, -9007199254740991);
    });
  });

  describe('optional flag tracking', () => {
    test('a top-level .optional() sets optional: true', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { optional, schema } = await evaluator.evaluate(
        'z.string().optional()',
      );
      assert.equal(optional, true);
      assert.equal(schema.type, 'string');
    });

    test('a required schema sets optional: false', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { optional } = await evaluator.evaluate('z.string()');
      assert.equal(optional, false);
    });

    test('a top-level .nullish() sets optional: true and adds null branch', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { optional, schema } = await evaluator.evaluate(
        'z.string().nullish()',
      );
      assert.equal(optional, true);
      assert.ok(Array.isArray(schema.anyOf) || Array.isArray(schema.type));
    });

    test('a nested optional inside an object leaves the root optional: false', async () => {
      using evaluator = new ZodEvaluator({ conditions: [] });
      const { optional, schema } = await evaluator.evaluate(
        'z.object({ a: z.string().optional() })',
      );
      assert.equal(optional, false);
      assert.equal(schema.type, 'object');
      assert.deepStrictEqual(at(schema, 'properties', 'a'), { type: 'string' });
      assert.deepStrictEqual(schema.required ?? [], []);
    });
  });
});
