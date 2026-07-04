import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { ZodEmitter } from './zod.ts';

const emptySpec = {} as OpenAPIObject;

describe('ZodEmitter date handling', () => {
  describe('plain string coercion', () => {
    test('coerce-string preserves basic string coercion', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', 'x-zod-type': 'coerce-string' }, true),
        'z.coerce.string()',
      );
    });

    test('coerce-string composes with string formats', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          { type: 'string', format: 'email', 'x-zod-type': 'coerce-string' },
          true,
        ),
        'z.coerce.string().pipe(z.email())',
      );
    });
  });

  describe('format: date-time (no x-zod-type)', () => {
    test('required', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date-time' },
        true,
      );
      assert.equal(result, 'z.iso.datetime({ offset: true })');
    });

    test('optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date-time' },
        false,
      );
      assert.equal(result, 'z.iso.datetime({ offset: true }).optional()');
    });

    test('with default', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        {
          type: 'string',
          format: 'date-time',
          default: '2024-01-01T00:00:00Z',
        },
        true,
      );
      assert.equal(
        result,
        'z.iso.datetime({ offset: true }).default("2024-01-01T00:00:00Z")',
      );
    });
  });

  describe('format: date-time with x-zod-type: date', () => {
    test('required', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date-time', 'x-zod-type': 'date' },
        true,
      );
      assert.equal(result, 'z.date()');
    });

    test('optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date-time', 'x-zod-type': 'date' },
        false,
      );
      assert.equal(result, 'z.date().optional()');
    });

    test('with default wraps in new Date()', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'date',
          default: '2024-01-01T00:00:00.000Z',
        },
        true,
      );
      assert.equal(
        result,
        'z.date().default(new Date("2024-01-01T00:00:00.000Z"))',
      );
    });
  });

  describe('format: date-time with x-zod-type: coerce-date', () => {
    test('required', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'coerce-date',
        },
        true,
      );
      assert.equal(result, 'z.coerce.date()');
    });

    test('optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'coerce-date',
        },
        false,
      );
      assert.equal(result, 'z.coerce.date().optional()');
    });

    test('with default wraps in new Date()', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'coerce-date',
          default: '2024-01-01T00:00:00.000Z',
        },
        true,
      );
      assert.equal(
        result,
        'z.coerce.date().default(new Date("2024-01-01T00:00:00.000Z"))',
      );
    });
  });

  describe('format: date', () => {
    test('required', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle({ type: 'string', format: 'date' }, true);
      assert.equal(result, 'z.iso.date()');
    });

    test('optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle({ type: 'string', format: 'date' }, false);
      assert.equal(result, 'z.iso.date().optional()');
    });

    test('with default stays as string', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date', default: '2024-01-01' },
        true,
      );
      assert.equal(result, 'z.iso.date().default("2024-01-01")');
    });
  });

  describe('nullable date via anyOf', () => {
    test('nullable z.date()', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        {
          anyOf: [
            {
              type: 'string',
              format: 'date-time',
              'x-zod-type': 'date',
            },
            { type: 'null' },
          ],
        },
        true,
      );
      assert.equal(result, 'z.union([z.date(), z.null()])');
    });

    test('nullable z.coerce.date()', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        {
          anyOf: [
            {
              type: 'string',
              format: 'date-time',
              'x-zod-type': 'coerce-date',
            },
            { type: 'null' },
          ],
        },
        true,
      );
      assert.equal(result, 'z.union([z.coerce.date(), z.null()])');
    });
  });

  describe('external spec (no x-zod-type) defaults correctly', () => {
    test('format datetime from external spec', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date-time' },
        true,
      );
      assert.equal(result, 'z.iso.datetime({ offset: true })');
    });

    test('format date from external spec', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle({ type: 'string', format: 'date' }, true);
      assert.equal(result, 'z.iso.date()');
    });
  });

  describe('cidr formats', () => {
    test('emit semantic cidr validators', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', format: 'cidrv4' }, true),
        'z.cidrv4()',
      );
      assert.equal(
        emitter.handle({ type: 'string', format: 'cidrv6' }, true),
        'z.cidrv6()',
      );
    });
  });

  describe('uuid format', () => {
    test('emits z.guid() to keep v3 GUID semantics', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', format: 'uuid' }, true),
        'z.guid()',
      );
    });
  });

  describe('enums', () => {
    test('integer enum emits a literal values array', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'integer', enum: [1, 2] }, true),
        'z.literal([1, 2])',
      );
    });

    test('numeric enum typed "number" emits a literal values array, not z.enum', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'number', enum: [1.5, 2.5] }, true),
        'z.literal([1.5, 2.5])',
      );
    });

    test('numeric enum with no declared type emits a literal values array', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(emitter.handle({ enum: [1, 2] }, true), 'z.literal([1, 2])');
    });

    test('string enum emits z.enum', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', enum: ['a', 'b'] }, true),
        'z.enum(["a", "b"])',
      );
    });
  });

  describe('number types', () => {
    test('z.number() required', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(emitter.handle({ type: 'number' }, true), 'z.number()');
    });

    test('z.number() optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'number' }, false),
        'z.number().optional()',
      );
    });

    test('integer type appends .int()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'integer' }, true),
        'z.number().int()',
      );
    });

    test('integer coerce appends .int()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          { type: 'integer', 'x-zod-type': 'coerce-number' },
          true,
        ),
        'z.coerce.number().int()',
      );
    });

    test('number with min/max', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'number', minimum: 0, maximum: 100 }, true),
        'z.number().min(0).max(100)',
      );
    });

    test('x-zod-type coerce-number produces z.coerce.number()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'number', 'x-zod-type': 'coerce-number' }, true),
        'z.coerce.number()',
      );
    });

    test('x-zod-type coerce-number with min/max', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          {
            type: 'number',
            'x-zod-type': 'coerce-number',
            minimum: 1,
            maximum: 10,
          },
          true,
        ),
        'z.coerce.number().min(1).max(10)',
      );
    });

    test('x-zod-type coerce-number optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          { type: 'number', 'x-zod-type': 'coerce-number' },
          false,
        ),
        'z.coerce.number().optional()',
      );
    });

    test('nullable integer union keeps coerced numeric branch', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          {
            anyOf: [
              { type: 'integer', 'x-zod-type': 'coerce-number' },
              { type: 'null' },
            ],
          },
          true,
        ),
        'z.union([z.coerce.number().int(), z.null()])',
      );
    });

    test('merged coerced integer keeps default and constraints', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          {
            type: 'integer',
            minimum: 0,
            default: 1,
            'x-zod-type': 'coerce-number',
          },
          true,
        ),
        'z.coerce.number().int().min(0).default(1)',
      );
    });
  });

  describe('64-bit integers', () => {
    // int64/uint64 stop being special: an integer on the wire is a plain
    // number, a string on the wire is a plain string. No bigint, no codec.
    test('integer int64 is a plain integer', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'integer', format: 'int64' }, true),
        'z.number().int()',
      );
    });

    test('integer uint64 is a plain integer', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'integer', format: 'uint64' }, true),
        'z.number().int()',
      );
    });

    test('integer int64 bounds emit as plain number literals', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          { type: 'integer', format: 'int64', minimum: 5, maximum: 100 },
          true,
        ),
        'z.number().int().min(5).max(100)',
      );
    });

    test('string-encoded int64 is a plain string', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', format: 'int64' }, true),
        'z.string()',
      );
    });

    test('string-encoded uint64 is a plain string', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', format: 'uint64' }, true),
        'z.string()',
      );
    });
  });

  // Emitted client code must not reference Blob as a runtime value — it
  // throws ReferenceError where the global is missing and fails instanceof
  // for cross-realm/polyfill Blobs (see e62c4e1, docs/recipes/file-upload.md).
  describe('binary types', () => {
    test('contentEncoding binary emits z.custom<Blob>()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', contentEncoding: 'binary' }, true),
        'z.custom<Blob>()',
      );
    });

    test('format byte emits z.custom<Blob>()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', format: 'byte' }, true),
        'z.custom<Blob>()',
      );
    });

    test('format binary emits z.custom<Blob>()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'string', format: 'binary' }, true),
        'z.custom<Blob>()',
      );
    });
  });

  describe('boolean types', () => {
    test('coerce-boolean produces z.coerce.boolean()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          { type: 'boolean', 'x-zod-type': 'coerce-boolean' },
          true,
        ),
        'z.union([z.boolean(), z.stringbool()])',
      );
    });

    test('coerce-boolean keeps default and optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          {
            type: 'boolean',
            default: true,
            'x-zod-type': 'coerce-boolean',
          },
          false,
        ),
        'z.union([z.boolean(), z.stringbool()]).optional().default(true)',
      );
    });
  });

  describe('composition keywords', () => {
    test('oneOf emits z.xor (exclusive), anyOf emits z.union', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          { oneOf: [{ type: 'string' }, { type: 'number' }] },
          true,
        ),
        'z.xor([z.string(), z.number()])',
      );
      assert.equal(
        emitter.handle(
          { anyOf: [{ type: 'string' }, { type: 'number' }] },
          true,
        ),
        'z.union([z.string(), z.number()])',
      );
    });
  });
});
