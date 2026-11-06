import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pointerTokens, valueAtPointer } from '@sdk-it/core';

void test('pointerTokens percent-decodes each fragment segment, then reads ~1 as / and ~0 as ~', () => {
  assert.deepEqual(
    pointerTokens('/components/responses/A~1B%20C/x~0y~01/p%7E1q'),
    ['components', 'responses', 'A/B C', 'x~y~1', 'p/q'],
  );
});

void test('valueAtPointer reads the own member each token names, and undefined where a token names none', () => {
  const document = { paths: { '/b': { get: { tags: ['x'] } } } };

  assert.deepEqual(
    [
      valueAtPointer(document, pointerTokens('/paths/~1b/get/tags/0')),
      valueAtPointer(document, ['paths', '/b', 'post']),
      valueAtPointer(document, ['paths', 'toString']),
    ],
    ['x', undefined, undefined],
  );
});
