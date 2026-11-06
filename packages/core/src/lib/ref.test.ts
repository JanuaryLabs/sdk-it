import assert from 'node:assert/strict';
import { test } from 'node:test';

import { followRef, tapRef } from '@sdk-it/core';

void test('followRef refuses references that form a cycle and names the cycle', () => {
  const document = {
    components: {
      responses: {
        A: { $ref: '#/components/responses/B' },
        B: { $ref: '#/components/responses/A' },
      },
    },
  };

  assert.throws(() => followRef(document, '#/components/responses/A'), {
    name: 'Error',
    message:
      /^Circular \$ref #\/components\/responses\/A -> #\/components\/responses\/B -> #\/components\/responses\/A:/,
  });
});

void test('followRef refuses a reference to itself', () => {
  const document = {
    components: { responses: { A: { $ref: '#/components/responses/A' } } },
  };

  assert.throws(() => followRef(document, '#/components/responses/A'), {
    name: 'Error',
    message:
      /^Circular \$ref #\/components\/responses\/A -> #\/components\/responses\/A:/,
  });
});

void test('followRef names the cycle, not the references that lead into it', () => {
  const document = {
    components: {
      responses: {
        X: { $ref: '#/components/responses/A' },
        A: { $ref: '#/components/responses/B' },
        B: { $ref: '#/components/responses/C' },
        C: { $ref: '#/components/responses/A' },
      },
    },
  };

  assert.throws(() => followRef(document, '#/components/responses/X'), {
    name: 'Error',
    message:
      /^Circular \$ref #\/components\/responses\/A -> #\/components\/responses\/B -> #\/components\/responses\/C -> #\/components\/responses\/A:/,
  });
});

void test('followRef follows a chain of references to the value at its end', () => {
  const document = {
    components: {
      responses: {
        A: { $ref: '#/components/responses/B' },
        B: { $ref: '#/components/responses/C' },
        C: { $ref: '#/components/responses/D' },
        D: { description: 'Gone' },
      },
    },
  };

  const response = followRef(document, '#/components/responses/A');

  assert.deepEqual(response, { description: 'Gone' });
});

void test('followRef reads ~1 in a reference as / (RFC 6901)', () => {
  const document = {
    paths: { '/pets/{petId}': { get: { summary: 'Show a pet' } } },
  };

  const pathItem = followRef(document, '#/paths/~1pets~1{petId}');

  assert.deepEqual(pathItem, { get: { summary: 'Show a pet' } });
});

void test('followRef reads ~0 in a reference as ~ (RFC 6901)', () => {
  const document = {
    components: { schemas: { 'a~b': { type: 'string' } } },
  };

  const schema = followRef(document, '#/components/schemas/a~0b');

  assert.deepEqual(schema, { type: 'string' });
});

void test('followRef percent-decodes a reference written as a URI fragment', () => {
  const document = {
    components: { schemas: { 'Pet Item': { type: 'object' } } },
  };

  const schema = followRef(document, '#/components/schemas/Pet%20Item');

  assert.deepEqual(schema, { type: 'object' });
});

void test('followRef names a cycle reached through encoded path pointers', () => {
  const document = {
    paths: {
      '/a': { $ref: '#/paths/~1b' },
      '/b': { $ref: '#/paths/~1a' },
    },
  };

  assert.throws(() => followRef(document, '#/paths/~1a'), {
    name: 'Error',
    message: /^Circular \$ref #\/paths\/~1a -> #\/paths\/~1b -> #\/paths\/~1a:/,
  });
});

void test('tapRef reads an RFC 6901 encoded reference', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1' },
    paths: {},
    components: { schemas: { 'a/b': { type: 'number' as const } } },
  };

  const schema = tapRef(document, { $ref: '#/components/schemas/a~1b' });

  assert.deepEqual(schema, { type: 'number' });
});
