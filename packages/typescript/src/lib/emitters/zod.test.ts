import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { analysisWorkspace } from '@sdk-it/testing';
import { renderModule } from '@sdk-it/typescript';

/**
 * The input schema the SDK exports for `POST /rows`, whose request body (JSON,
 * or `contentType`) is an object with one property `value`, required or not.
 */
async function rowInput(options: {
  value: SchemaObject;
  required: boolean;
  contentType?: string;
}) {
  const { text } = await renderModule(
    {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/rows': {
          post: {
            operationId: 'createRow',
            requestBody: {
              required: true,
              content: {
                [options.contentType ?? 'application/json']: {
                  schema: {
                    type: 'object',
                    properties: { value: options.value },
                    required: options.required ? ['value'] : [],
                  },
                },
              },
            },
            responses: { '204': { description: 'No Content' } },
          },
        },
      },
    },
    { name: 'Client' },
  );
  await using workspace = await analysisWorkspace('zod-input-', {
    'sdk.ts': text,
  });
  const sdk = await import(pathToFileURL(join(workspace.path, 'sdk.ts')).href);
  return sdk.createRowSchema;
}

describe('ZodEmitter date handling', () => {
  describe('plain string coercion', () => {
    test('coerce-string preserves basic string coercion', async () => {
      const row = await rowInput({
        value: { type: 'string', 'x-zod-type': 'coerce-string' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 5 }), { value: '5' });
      assert.equal(row.safeParse({}).success, false);
    });

    test('coerce-string composes with string formats', async () => {
      const row = await rowInput({
        value: {
          type: 'string',
          format: 'email',
          'x-zod-type': 'coerce-string',
        },
        required: true,
      });

      assert.deepStrictEqual(
        row.parse({ value: { toString: () => 'ada@example.com' } }),
        { value: 'ada@example.com' },
      );
      assert.equal(row.safeParse({ value: 'not an email' }).success, false);
    });
  });

  describe('format: date-time (no x-zod-type)', () => {
    test('required', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date-time' },
        required: true,
      });

      assert.deepStrictEqual(
        row.parse({ value: '2024-01-01T00:00:00+03:00' }),
        {
          value: '2024-01-01T00:00:00+03:00',
        },
      );
      assert.equal(row.safeParse({ value: '2024-01-01' }).success, false);
      assert.equal(row.safeParse({}).success, false);
    });

    test('optional', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date-time' },
        required: false,
      });

      assert.deepStrictEqual(row.parse({}), {});
      assert.deepStrictEqual(row.parse({ value: '2024-01-01T00:00:00Z' }), {
        value: '2024-01-01T00:00:00Z',
      });
      assert.equal(row.safeParse({ value: '2024-01-01' }).success, false);
    });

    test('with default', async () => {
      const row = await rowInput({
        value: {
          type: 'string',
          format: 'date-time',
          default: '2024-01-01T00:00:00Z',
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({}), { value: '2024-01-01T00:00:00Z' });
      assert.equal(row.safeParse({ value: '2024-01-01' }).success, false);
    });
  });

  describe('format: date-time with x-zod-type: date', () => {
    test('required', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date-time', 'x-zod-type': 'date' },
        required: true,
      });
      const value = new Date('2024-01-01T00:00:00.000Z');

      assert.deepStrictEqual(row.parse({ value }), { value });
      assert.equal(
        row.safeParse({ value: '2024-01-01T00:00:00.000Z' }).success,
        false,
      );
      assert.equal(row.safeParse({}).success, false);
    });

    test('optional', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date-time', 'x-zod-type': 'date' },
        required: false,
      });

      assert.deepStrictEqual(row.parse({}), {});
      const value = new Date('2024-01-01T00:00:00.000Z');
      assert.deepStrictEqual(row.parse({ value }), { value });
      assert.equal(
        row.safeParse({ value: '2024-01-01T00:00:00.000Z' }).success,
        false,
      );
    });

    test('with default wraps in new Date()', async () => {
      const row = await rowInput({
        value: {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'date',
          default: '2024-01-01T00:00:00.000Z',
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({}), {
        value: new Date('2024-01-01T00:00:00.000Z'),
      });
    });
  });

  describe('format: date-time with x-zod-type: coerce-date', () => {
    test('required', async () => {
      const row = await rowInput({
        value: {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'coerce-date',
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '2024-01-01T00:00:00.000Z' }), {
        value: new Date('2024-01-01T00:00:00.000Z'),
      });
      assert.equal(row.safeParse({ value: 'not a date' }).success, false);
      assert.equal(row.safeParse({}).success, false);
    });

    test('optional', async () => {
      const row = await rowInput({
        value: {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'coerce-date',
        },
        required: false,
      });

      assert.deepStrictEqual(row.parse({}), {});
      assert.deepStrictEqual(row.parse({ value: '2024-01-01T00:00:00.000Z' }), {
        value: new Date('2024-01-01T00:00:00.000Z'),
      });
    });

    test('with default wraps in new Date()', async () => {
      const row = await rowInput({
        value: {
          type: 'string',
          format: 'date-time',
          'x-zod-type': 'coerce-date',
          default: '2024-01-01T00:00:00.000Z',
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({}), {
        value: new Date('2024-01-01T00:00:00.000Z'),
      });
    });
  });

  describe('format: date', () => {
    test('required', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '2024-01-01' }), {
        value: '2024-01-01',
      });
      assert.equal(
        row.safeParse({ value: '2024-01-01T00:00:00Z' }).success,
        false,
      );
      assert.equal(row.safeParse({}).success, false);
    });

    test('optional', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date' },
        required: false,
      });

      assert.deepStrictEqual(row.parse({}), {});
      assert.deepStrictEqual(row.parse({ value: '2024-01-01' }), {
        value: '2024-01-01',
      });
      assert.equal(
        row.safeParse({ value: '2024-01-01T00:00:00Z' }).success,
        false,
      );
    });

    test('with default stays as string', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date', default: '2024-01-01' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({}), { value: '2024-01-01' });
    });
  });

  describe('nullable date via anyOf', () => {
    test('nullable z.date()', async () => {
      const row = await rowInput({
        value: {
          anyOf: [
            { type: 'string', format: 'date-time', 'x-zod-type': 'date' },
            { type: 'null' },
          ],
        },
        required: true,
      });
      const value = new Date('2024-01-01T00:00:00.000Z');

      assert.deepStrictEqual(row.parse({ value }), { value });
      assert.deepStrictEqual(row.parse({ value: null }), { value: null });
      assert.equal(
        row.safeParse({ value: '2024-01-01T00:00:00.000Z' }).success,
        false,
      );
    });

    test('nullable z.coerce.date()', async () => {
      const row = await rowInput({
        value: {
          anyOf: [
            {
              type: 'string',
              format: 'date-time',
              'x-zod-type': 'coerce-date',
            },
            { type: 'null' },
          ],
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '2024-01-01T00:00:00.000Z' }), {
        value: new Date('2024-01-01T00:00:00.000Z'),
      });
      assert.deepStrictEqual(row.parse({ value: null }), { value: null });
      assert.equal(row.safeParse({ value: 'not a date' }).success, false);
    });
  });

  describe('external spec (no x-zod-type) defaults correctly', () => {
    test('format datetime from external spec', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date-time' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '2024-01-01T00:00:00Z' }), {
        value: '2024-01-01T00:00:00Z',
      });
      assert.equal(row.safeParse({ value: '2024-01-01' }).success, false);
    });

    test('format date from external spec', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'date' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '2024-01-01' }), {
        value: '2024-01-01',
      });
      assert.equal(row.safeParse({ value: 'yesterday' }).success, false);
    });
  });

  describe('cidr formats', () => {
    test('emit semantic cidr validators', async () => {
      const v4 = await rowInput({
        value: { type: 'string', format: 'cidrv4' },
        required: true,
      });
      const v6 = await rowInput({
        value: { type: 'string', format: 'cidrv6' },
        required: true,
      });

      assert.equal(v4.safeParse({ value: '10.0.0.0/8' }).success, true);
      assert.equal(v4.safeParse({ value: '10.0.0.0' }).success, false);
      assert.equal(v4.safeParse({ value: '2001:db8::/32' }).success, false);
      assert.equal(v6.safeParse({ value: '2001:db8::/32' }).success, true);
      assert.equal(v6.safeParse({ value: '10.0.0.0/8' }).success, false);
    });
  });

  describe('uuid format', () => {
    test('emits z.guid() to keep v3 GUID semantics', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'uuid' },
        required: true,
      });

      // Variant nibble 1 is outside RFC 9562, which z.uuid() refuses.
      assert.equal(
        row.safeParse({ value: '12345678-1234-1234-1234-123456789abc' })
          .success,
        true,
      );
      assert.equal(row.safeParse({ value: 'not-a-guid' }).success, false);
    });
  });

  describe('enums', () => {
    test('integer enum emits a literal values array', async () => {
      const row = await rowInput({
        value: { type: 'integer', enum: [1, 2] },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 2 }), { value: 2 });
      assert.equal(row.safeParse({ value: 3 }).success, false);
      assert.equal(row.safeParse({ value: '1' }).success, false);
    });

    test('numeric enum typed "number" emits a literal values array, not z.enum', async () => {
      const row = await rowInput({
        value: { type: 'number', enum: [1.5, 2.5] },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 1.5 }), { value: 1.5 });
      assert.equal(row.safeParse({ value: 2 }).success, false);
    });

    test('numeric enum with no declared type emits a literal values array', async () => {
      const row = await rowInput({ value: { enum: [1, 2] }, required: true });

      assert.deepStrictEqual(row.parse({ value: 1 }), { value: 1 });
      assert.equal(row.safeParse({ value: '1' }).success, false);
    });

    test('string enum emits z.enum', async () => {
      const row = await rowInput({
        value: { type: 'string', enum: ['a', 'b'] },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 'b' }), { value: 'b' });
      assert.equal(row.safeParse({ value: 'c' }).success, false);
    });
  });

  describe('number types', () => {
    test('z.number() required', async () => {
      const row = await rowInput({ value: { type: 'number' }, required: true });

      assert.deepStrictEqual(row.parse({ value: 1.5 }), { value: 1.5 });
      assert.equal(row.safeParse({ value: '1' }).success, false);
      assert.equal(row.safeParse({}).success, false);
    });

    test('z.number() optional', async () => {
      const row = await rowInput({
        value: { type: 'number' },
        required: false,
      });

      assert.deepStrictEqual(row.parse({}), {});
      assert.deepStrictEqual(row.parse({ value: 1.5 }), { value: 1.5 });
      assert.equal(row.safeParse({ value: '1' }).success, false);
    });

    test('integer type appends .int()', async () => {
      const row = await rowInput({
        value: { type: 'integer' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 2 }), { value: 2 });
      assert.equal(row.safeParse({ value: 1.5 }).success, false);
    });

    test('integer coerce appends .int()', async () => {
      const row = await rowInput({
        value: { type: 'integer', 'x-zod-type': 'coerce-number' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '3' }), { value: 3 });
      assert.equal(row.safeParse({ value: '1.5' }).success, false);
    });

    test('number with min/max', async () => {
      const row = await rowInput({
        value: { type: 'number', minimum: 0, maximum: 100 },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 0 }), { value: 0 });
      assert.deepStrictEqual(row.parse({ value: 100 }), { value: 100 });
      assert.equal(row.safeParse({ value: -1 }).success, false);
      assert.equal(row.safeParse({ value: 101 }).success, false);
    });

    test('x-zod-type coerce-number produces z.coerce.number()', async () => {
      const row = await rowInput({
        value: { type: 'number', 'x-zod-type': 'coerce-number' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '2.5' }), { value: 2.5 });
      assert.equal(row.safeParse({ value: 'two' }).success, false);
    });

    test('x-zod-type coerce-number with min/max', async () => {
      const row = await rowInput({
        value: {
          type: 'number',
          'x-zod-type': 'coerce-number',
          minimum: 1,
          maximum: 10,
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '1' }), { value: 1 });
      assert.deepStrictEqual(row.parse({ value: '10' }), { value: 10 });
      assert.equal(row.safeParse({ value: '0' }).success, false);
      assert.equal(row.safeParse({ value: '11' }).success, false);
    });

    test('x-zod-type coerce-number optional', async () => {
      const row = await rowInput({
        value: { type: 'number', 'x-zod-type': 'coerce-number' },
        required: false,
      });

      assert.deepStrictEqual(row.parse({}), {});
      assert.deepStrictEqual(row.parse({ value: '2' }), { value: 2 });
    });

    test('nullable integer union keeps coerced numeric branch', async () => {
      const row = await rowInput({
        value: {
          anyOf: [
            { type: 'integer', 'x-zod-type': 'coerce-number' },
            { type: 'null' },
          ],
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '4' }), { value: 4 });
      assert.deepStrictEqual(row.parse({ value: null }), { value: null });
      assert.equal(row.safeParse({ value: '1.5' }).success, false);
    });

    test('merged coerced integer keeps default and constraints', async () => {
      const row = await rowInput({
        value: {
          type: 'integer',
          minimum: 0,
          default: 1,
          'x-zod-type': 'coerce-number',
        },
        required: true,
      });

      assert.deepStrictEqual(row.parse({}), { value: 1 });
      assert.deepStrictEqual(row.parse({ value: '3' }), { value: 3 });
      assert.equal(row.safeParse({ value: '-1' }).success, false);
      assert.equal(row.safeParse({ value: '1.5' }).success, false);
    });
  });

  describe('64-bit integers', () => {
    // int64/uint64 stop being special: an integer on the wire is a plain
    // number, a string on the wire is a plain string. No bigint, no codec.
    test('integer int64 is a plain integer', async () => {
      const row = await rowInput({
        value: { type: 'integer', format: 'int64' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 5 }), { value: 5 });
      assert.equal(row.safeParse({ value: 5n }).success, false);
      assert.equal(row.safeParse({ value: '5' }).success, false);
      assert.equal(row.safeParse({ value: 1.5 }).success, false);
    });

    test('integer uint64 is a plain integer', async () => {
      const row = await rowInput({
        value: { type: 'integer', format: 'uint64' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 5 }), { value: 5 });
      assert.equal(row.safeParse({ value: 5n }).success, false);
      assert.equal(row.safeParse({ value: '5' }).success, false);
      assert.equal(row.safeParse({ value: 1.5 }).success, false);
    });

    test('integer int64 bounds emit as plain number literals', async () => {
      const row = await rowInput({
        value: { type: 'integer', format: 'int64', minimum: 5, maximum: 100 },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: 5 }), { value: 5 });
      assert.deepStrictEqual(row.parse({ value: 100 }), { value: 100 });
      assert.equal(row.safeParse({ value: 4 }).success, false);
      assert.equal(row.safeParse({ value: 101 }).success, false);
      assert.equal(row.safeParse({ value: 50n }).success, false);
    });

    test('string-encoded int64 is a plain string', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'int64' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '9007199254740993' }), {
        value: '9007199254740993',
      });
      assert.equal(row.safeParse({ value: 5 }).success, false);
    });

    test('string-encoded uint64 is a plain string', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'uint64' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: '18446744073709551615' }), {
        value: '18446744073709551615',
      });
      assert.equal(row.safeParse({ value: 5 }).success, false);
    });
  });

  // Emitted client code must not reference Blob as a runtime value — it
  // throws ReferenceError where the global is missing and fails instanceof
  // for cross-realm/polyfill Blobs (see e62c4e1, docs/recipes/file-upload.md).
  describe('binary types', () => {
    test('contentEncoding binary emits z.custom<Blob>()', async () => {
      const row = await rowInput({
        value: { type: 'string', contentEncoding: 'binary' },
        required: true,
        contentType: 'multipart/form-data',
      });
      const blob = new Blob(['hi']);
      const crossRealm = { size: 2, type: '', slice: () => blob };

      assert.deepStrictEqual(row.parse({ value: blob }), { value: blob });
      assert.deepStrictEqual(row.parse({ value: crossRealm }), {
        value: crossRealm,
      });
    });

    test('format byte emits z.custom<Blob>()', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'byte' },
        required: true,
        contentType: 'multipart/form-data',
      });
      const blob = new Blob(['hi']);
      const crossRealm = { size: 2, type: '', slice: () => blob };

      assert.deepStrictEqual(row.parse({ value: blob }), { value: blob });
      assert.deepStrictEqual(row.parse({ value: crossRealm }), {
        value: crossRealm,
      });
    });

    test('format binary emits z.custom<Blob>()', async () => {
      const row = await rowInput({
        value: { type: 'string', format: 'binary' },
        required: true,
        contentType: 'multipart/form-data',
      });
      const blob = new Blob(['hi']);
      const crossRealm = { size: 2, type: '', slice: () => blob };

      assert.deepStrictEqual(row.parse({ value: blob }), { value: blob });
      assert.deepStrictEqual(row.parse({ value: crossRealm }), {
        value: crossRealm,
      });
    });
  });

  describe('boolean types', () => {
    test('coerce-boolean produces z.coerce.boolean()', async () => {
      const row = await rowInput({
        value: { type: 'boolean', 'x-zod-type': 'coerce-boolean' },
        required: true,
      });

      assert.deepStrictEqual(row.parse({ value: true }), { value: true });
      assert.deepStrictEqual(row.parse({ value: 'true' }), { value: true });
      assert.deepStrictEqual(row.parse({ value: 'no' }), { value: false });
      assert.equal(row.safeParse({ value: 'maybe' }).success, false);
    });

    test('coerce-boolean keeps default and optional', async () => {
      const row = await rowInput({
        value: {
          type: 'boolean',
          default: true,
          'x-zod-type': 'coerce-boolean',
        },
        required: false,
      });

      assert.deepStrictEqual(row.parse({}), { value: true });
      assert.deepStrictEqual(row.parse({ value: 'off' }), { value: false });
    });
  });

  describe('composition keywords', () => {
    test('oneOf emits z.xor (exclusive), anyOf emits z.union', async () => {
      const oneOf = await rowInput({
        value: { oneOf: [{ type: 'number' }, { type: 'number', minimum: 0 }] },
        required: true,
      });
      const anyOf = await rowInput({
        value: { anyOf: [{ type: 'number' }, { type: 'number', minimum: 0 }] },
        required: true,
      });
      const stringOrNumber = await rowInput({
        value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        required: true,
      });

      assert.deepStrictEqual(oneOf.parse({ value: -1 }), { value: -1 });
      assert.equal(oneOf.safeParse({ value: 5 }).success, false);
      assert.deepStrictEqual(anyOf.parse({ value: 5 }), { value: 5 });
      assert.equal(anyOf.safeParse({ value: 'five' }).success, false);
      assert.deepStrictEqual(stringOrNumber.parse({ value: 'x' }), {
        value: 'x',
      });
      assert.deepStrictEqual(stringOrNumber.parse({ value: 1 }), { value: 1 });
    });
  });
});
