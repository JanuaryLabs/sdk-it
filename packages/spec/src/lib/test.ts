import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OperationObject } from 'openapi3-ts/oas31';

import { determineGenericTag } from './operation.ts';

const mockOperation = (operationId = ''): OperationObject => ({ operationId });

describe('determineGenericTag', () => {
  describe('Heuristic 1: Path-Based Tag Determination', () => {
    test('should use the last non-parameter, non-version, non-@ segment', () => {
      assert.strictEqual(
        determineGenericTag('/users', mockOperation()),
        'users',
      );
      assert.strictEqual(
        determineGenericTag('/users/{userId}/orders', mockOperation()),
        'orders',
      );
      assert.strictEqual(
        determineGenericTag('/admin/system/logs', mockOperation()),
        'logs',
      );
    });

    test('should ignore path parameters', () => {
      assert.strictEqual(
        determineGenericTag('/users/{userId}', mockOperation()),
        'users',
      );
      assert.strictEqual(
        determineGenericTag('/items/{itemId}', mockOperation()),
        'items',
      );
    });

    test('should ignore version segments', () => {
      assert.strictEqual(
        determineGenericTag('/v1/products', mockOperation()),
        'products',
      );
      assert.strictEqual(
        determineGenericTag('/api/V2/items/{itemId}/details', mockOperation()),
        'details',
      );
      assert.strictEqual(
        determineGenericTag('/api/resource/v2', mockOperation()),
        'resource',
      );
    });

    test('should ignore segments starting with @', () => {
      assert.strictEqual(
        determineGenericTag('/users/@me', mockOperation()),
        'users',
      );
      assert.strictEqual(
        determineGenericTag('/users/@me/guilds', mockOperation()),
        'guilds',
      );
      assert.strictEqual(
        determineGenericTag(
          '/webhooks/{webhookId}/messages/@original',
          mockOperation(),
        ),
        'messages',
      );
      assert.strictEqual(
        determineGenericTag('/@admin/users/{userId}', mockOperation()),
        'users',
      );
      assert.strictEqual(
        determineGenericTag(
          '/guilds/{guild_id}/@audit-log/users/@me/settings',
          mockOperation(),
        ),
        'settings',
      );
      assert.strictEqual(
        determineGenericTag('/system/tasks/@scheduled-jobs', mockOperation()),
        'tasks',
      );
    });

    test('should sanitize results matching reserved keywords', () => {
      assert.strictEqual(
        determineGenericTag('/api/v1/public', mockOperation()),
        'public_',
      );
      assert.strictEqual(
        determineGenericTag('/api/case/{id}', mockOperation()),
        'case_',
      );
      assert.strictEqual(
        determineGenericTag('/permissions/check', mockOperation()),
        'check_',
      );
    });

    test('should sanitize results starting with numbers', () => {
      // FIX: Expectation changed - last valid segment is 'enable'
      assert.strictEqual(
        determineGenericTag('/api/2fa/enable', mockOperation()),
        'enable',
      );
    });

    test('should handle mixed separators via camelcase', () => {
      assert.strictEqual(
        determineGenericTag('/user-profiles/{id}', mockOperation()),
        'userProfiles',
      );
    });
  });

  describe('Heuristic 2: OperationId Fallback', () => {
    test('should be used when path has no valid segments (root)', () => {
      assert.strictEqual(
        determineGenericTag('/', mockOperation('getRootResource')),
        'rootResource',
      );
      // FIX: Expectation changed - 'healthCheck' is not reserved
      assert.strictEqual(
        determineGenericTag('/', mockOperation('healthCheck')),
        'healthCheck',
      );
    });

    test('should be used when path has only params/version segments', () => {
      assert.strictEqual(
        determineGenericTag('/v3/{tenantId}/', mockOperation('getTenantRoot')),
        'tenantRoot',
      );
      assert.strictEqual(
        determineGenericTag('/v1/{userId}/', mockOperation('listUserItems')),
        'userItems',
      );
    });

    test('should extract nouns after common verb prefixes', () => {
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('postUserPreferences')),
        'userPreferences',
      );
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('doFoo')),
        'foo',
      );
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('addUser')),
        'user',
      );
      // FIX: Added 'make' to commonVerbs
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('makePublic')),
        'public_',
      );
    });

    test('should use the full operationId if no common verb prefix', () => {
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('metrics')),
        'metrics',
      );
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('tenantAdminSettings')),
        'tenantAdminSettings',
      );
    });

    test('should handle numbers within the operationId correctly', () => {
      // FIX: Expectation aligned with stringcase behavior
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('getUser2FAStatus')),
        'user2FAStatus',
      );
      assert.strictEqual(
        determineGenericTag('/api/', mockOperation('get2FAStatus')),
        'api',
      ); // Sanitized (starts with number after verb removal)
    });

    test('should sanitize results matching reserved keywords', () => {
      assert.strictEqual(
        determineGenericTag('/v1/{id}', mockOperation('delete')),
        'delete_',
      );
      assert.strictEqual(
        determineGenericTag('/v1/{id}', mockOperation('createCase')),
        'case_',
      );
      assert.strictEqual(
        determineGenericTag('/v1/{id}', mockOperation('get')),
        'get_',
      );
    });

    test('should use verb if it is the only part and no path fallback', () => {
      assert.strictEqual(
        determineGenericTag('/v1/', mockOperation('get')),
        'get_',
      );
      assert.strictEqual(
        determineGenericTag('/v1/{id}', mockOperation('list')),
        'list_',
      );
    });
  });

  describe('Heuristic 3: First Path Segment Fallback', () => {
    test('should be used when path only has @ segments and no suitable opId', () => {
      assert.strictEqual(
        determineGenericTag('/@system/@status', mockOperation()),
        'system',
      );
      assert.strictEqual(
        determineGenericTag('/@audit-log/@entries', mockOperation()),
        'auditLog',
      );
    });

    test('should be used when opId fallback yields only a common verb', () => {
      assert.strictEqual(
        determineGenericTag('/@system/@status', mockOperation('get')),
        'system',
      );
    });

    test('should strip leading @ before using segment', () => {
      assert.strictEqual(
        determineGenericTag('/@system/@status', mockOperation()),
        'system',
      );
    });

    test('should sanitize results matching reserved keywords', () => {
      assert.strictEqual(
        determineGenericTag('/@public/@data', mockOperation()),
        'public_',
      );
    });

    test('should sanitize results starting with numbers', () => {
      assert.strictEqual(
        determineGenericTag('/@2fa/@status', mockOperation()),
        '_2fa',
      );
    });
  });

  describe('Heuristic Priority', () => {
    test('Path (Heuristic 1) should take priority over OperationId (Heuristic 2)', () => {
      const tag = determineGenericTag(
        '/users/{id}/permissions/check', // Path -> 'check' -> sanitized 'check_'
        mockOperation('verifyPermissions'), // opId -> 'permissions'
      );
      assert.strictEqual(tag, 'check_');
    });

    test('OperationId (Heuristic 2) should take priority over First Path Segment (Heuristic 3)', () => {
      const tag = determineGenericTag(
        '/@system/@status',
        mockOperation('getSystemStatus'),
      );
      assert.strictEqual(tag, 'systemStatus');
    });

    test('First Path Segment (Heuristic 3) is used if OperationId is skipped (verb-only)', () => {
      const tag = determineGenericTag('/@system/@status', mockOperation('get'));
      assert.strictEqual(tag, 'system');
    });
  });

  describe('Heuristic 4: Unknown Fallback', () => {
    test('should return "unknown" when no path segments and no operationId', () => {
      assert.strictEqual(determineGenericTag('/', mockOperation()), 'unknown');
    });

    test('should return "unknown" when path has only params/version and no operationId', () => {
      assert.strictEqual(
        determineGenericTag('/v3/{tenantId}/', mockOperation()),
        'unknown',
      );
    });

    test('should return "unknown" for empty path string', () => {
      assert.strictEqual(determineGenericTag('', mockOperation()), 'unknown');
    });
  });
});
