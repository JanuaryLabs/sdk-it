import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { ZodEmitter } from './zod.ts';

const emptySpec = {} as OpenAPIObject;

describe('ZodEmitter date handling', () => {
  describe('format: date-time (no x-zod-type)', () => {
    test('required', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date-time' },
        true,
      );
      assert.equal(result, 'z.string().datetime()');
    });

    test('optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date-time' },
        false,
      );
      assert.equal(result, 'z.string().datetime().optional()');
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
        'z.string().datetime().default("2024-01-01T00:00:00Z")',
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
      const result = emitter.handle(
        { type: 'string', format: 'date' },
        true,
      );
      assert.equal(result, 'z.string().date()');
    });

    test('optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date' },
        false,
      );
      assert.equal(result, 'z.string().date().optional()');
    });

    test('with default stays as string', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date', default: '2024-01-01' },
        true,
      );
      assert.equal(result, 'z.string().date().default("2024-01-01")');
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
      assert.equal(result, 'z.string().datetime()');
    });

    test('format date from external spec', () => {
      const emitter = new ZodEmitter(emptySpec);
      const result = emitter.handle(
        { type: 'string', format: 'date' },
        true,
      );
      assert.equal(result, 'z.string().date()');
    });
  });

  describe('number types', () => {
    test('z.number() required', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'number' }, true),
        'z.number()',
      );
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
        emitter.handle(
          { type: 'number', 'x-zod-type': 'coerce-number' },
          true,
        ),
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
  });

  describe('bigint types', () => {
    test('int64 format produces z.bigint()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle({ type: 'integer', format: 'int64' }, true),
        'z.bigint()',
      );
    });

    test('x-zod-type coerce-bigint produces z.coerce.bigint()', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          {
            type: 'integer',
            format: 'int64',
            'x-zod-type': 'coerce-bigint',
          },
          true,
        ),
        'z.coerce.bigint()',
      );
    });

    test('coerce-bigint optional', () => {
      const emitter = new ZodEmitter(emptySpec);
      assert.equal(
        emitter.handle(
          {
            type: 'integer',
            format: 'int64',
            'x-zod-type': 'coerce-bigint',
          },
          false,
        ),
        'z.coerce.bigint().optional()',
      );
    });
  });
});
