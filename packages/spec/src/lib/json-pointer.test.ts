import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pointerTokens } from '@sdk-it/spec';

void test('pointerTokens percent-decodes each fragment segment, then reads ~1 as / and ~0 as ~', () => {
  assert.deepEqual(
    pointerTokens('/components/responses/A~1B%20C/x~0y~01/p%7E1q'),
    ['components', 'responses', 'A/B C', 'x~y~1', 'p/q'],
  );
});
