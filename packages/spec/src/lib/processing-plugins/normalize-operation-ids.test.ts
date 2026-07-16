import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeOperationIds, processSpec } from '@sdk-it/spec';

test('custom operation ID formatting preserves the previous two-pass behavior', async () => {
  const seenOperationIds: Array<string | undefined> = [];
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Operations', version: '1.0.0' },
      paths: {
        '/users/{userId}': {
          get: { operationId: 'getUser', responses: {} },
        },
      },
    },
    operationId(operation) {
      seenOperationIds.push(operation.operationId);
      return `${operation.operationId}Sdk`;
    },
    plugins: [normalizeOperationIds()],
  });

  assert.deepStrictEqual(seenOperationIds, ['getUser', 'getUserSdk']);
  assert.strictEqual(
    spec.paths['/users/{userId}'].get?.operationId,
    'getUserSdkSdk',
  );
});
