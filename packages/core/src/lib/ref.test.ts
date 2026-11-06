import assert from 'node:assert/strict';
import { test } from 'node:test';

import { followRef } from '@sdk-it/core';

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
