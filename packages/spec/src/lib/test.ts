import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { determineGenericTag } from './operation.ts';

const mockOperation = (operationId = '') => ({ operationId });

describe('determineGenericTag', () => {
  test('1. Simple root resource', () => {
    const tag = determineGenericTag('/users', mockOperation());
    assert.strictEqual(tag, 'users', 'Test Case 1 Failed: Simple root');
  });

  test('2. Resource with parameter', () => {
    const tag = determineGenericTag('/users/{userId}', mockOperation());
    assert.strictEqual(tag, 'users', 'Test Case 2 Failed: Resource with param');
  });

  test('3. Nested resource', () => {
    const tag = determineGenericTag('/users/{userId}/orders', mockOperation());
    assert.strictEqual(tag, 'orders', 'Test Case 3 Failed: Nested resource');
  });

  test('4. Path with version prefix (v1)', () => {
    const tag = determineGenericTag('/v1/products', mockOperation());
    assert.strictEqual(tag, 'products', 'Test Case 4 Failed: v1 prefix');
  });

  test('5. Path with version prefix (V2) and nesting', () => {
    const tag = determineGenericTag(
      '/api/V2/items/{itemId}/details',
      mockOperation(),
    );
    assert.strictEqual(tag, 'details', 'Test Case 5 Failed: V2 prefix nested');
  });

  test('6. Path ending with @me', () => {
    const tag = determineGenericTag('/users/@me', mockOperation());
    assert.strictEqual(tag, 'users', 'Test Case 6 Failed: Ends with @me');
  });

  test('7. Path with @me in the middle', () => {
    const tag = determineGenericTag('/users/@me/guilds', mockOperation());
    assert.strictEqual(tag, 'guilds', 'Test Case 7 Failed: @me in middle');
  });

  test('8. Path with @original at the end', () => {
    const tag = determineGenericTag(
      '/webhooks/{webhookId}/messages/@original',
      mockOperation(),
    );
    assert.strictEqual(tag, 'messages', 'Test Case 8 Failed: @original at end');
  });

  test('9. Path with only @ segments (fallback to opId)', () => {
    const tag = determineGenericTag(
      '/@system/@status',
      mockOperation('getSystemStatus'),
    );
    assert.strictEqual(
      tag,
      'get',
      'Test Case 9 Failed: Only @ segments, use opId',
    );
  });

  test('10. Path with only @ segments (fallback to first @ segment)', () => {
    const tag = determineGenericTag('/@system/@status/check', mockOperation()); // No helpful opId
    assert.strictEqual(
      tag,
      'check',
      'Test Case 10 Failed: Only @ segments, use last non-@',
    );
  });

  test('10b. Path with only @ segments (fallback to first @ segment after removing @)', () => {
    const tag = determineGenericTag('/@system/@status', mockOperation()); // No helpful opId, no non-@ segment
    assert.strictEqual(
      tag,
      'system',
      'Test Case 10b Failed: Only @ segments, use first @ segment',
    );
  });

  test('11. Path ends with parameter, use segment before', () => {
    const tag = determineGenericTag('/items/{itemId}', mockOperation());
    assert.strictEqual(tag, 'items', 'Test Case 11 Failed: Ends with param');
  });

  test('12. Multi-segment path', () => {
    const tag = determineGenericTag('/admin/system/logs', mockOperation());
    assert.strictEqual(tag, 'logs', 'Test Case 12 Failed: Multi-segment');
  });

  test('13. Root path (fallback to opId)', () => {
    const tag = determineGenericTag('/', mockOperation('getRootResource'));
    assert.strictEqual(tag, 'get', 'Test Case 13 Failed: Root path, use opId');
  });

  test('14. Root path (fallback to unknown)', () => {
    const tag = determineGenericTag('/', mockOperation()); // No opId
    assert.strictEqual(
      tag,
      'unknown',
      'Test Case 14 Failed: Root path, unknown',
    );
  });

  test('15. Path with only params/version (fallback to opId)', () => {
    const tag = determineGenericTag(
      '/v3/{tenantId}/',
      mockOperation('getTenantRoot'),
    );
    assert.strictEqual(
      tag,
      'get',
      'Test Case 15 Failed: Only params/version, use opId',
    );
  });

  test('16. Path with only params/version (fallback to unknown)', () => {
    const tag = determineGenericTag('/v3/{tenantId}/', mockOperation());
    assert.strictEqual(
      tag,
      'unknown',
      'Test Case 16 Failed: Only params/version, unknown',
    );
  });

  test('17. Path with mixed separators (handled by camelcase)', () => {
    // Assuming camelcase handles this, the segment is 'user-profiles'
    const tag = determineGenericTag(
      '/api/v1/user-profiles/{profileId}',
      mockOperation(),
    );
    assert.strictEqual(
      tag,
      'userProfiles',
      'Test Case 17 Failed: Mixed separators',
    );
  });

  test('18. Path starting with @ segment', () => {
    const tag = determineGenericTag('/@admin/users/{userId}', mockOperation());
    assert.strictEqual(tag, 'users', 'Test Case 18 Failed: Starts with @');
  });

  test('19. Path with version segment as last meaningful part (should be skipped)', () => {
    const tag = determineGenericTag('/api/resource/v2', mockOperation());
    assert.strictEqual(
      tag,
      'resource',
      'Test Case 19 Failed: Version as last part',
    );
  });

  test('20. Path with parameter containing underscore', () => {
    const tag = determineGenericTag(
      '/data_sets/{set_id}/entries',
      mockOperation(),
    );
    assert.strictEqual(
      tag,
      'entries',
      'Test Case 20 Failed: Param with underscore',
    );
  });
});
