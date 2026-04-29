import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { OperationPagination } from '@sdk-it/spec';

import { paginationOperation } from './pagination-emit.ts';

const guardPattern = /result\.status\s*!==\s*200/;

describe('paginationOperation status narrowing', () => {
  test('offset pagination guards on success status before reading items', () => {
    const pagination: OperationPagination = {
      type: 'offset',
      items: 'threads',
      hasMore: 'has_more',
      statusCode: 200,
      offsetParamName: 'offset',
      offsetKeyword: 'offset',
      limitParamName: 'limit',
      limitKeyword: 'limit',
    };
    const emitted = paginationOperation(pagination);

    assert.match(emitted, guardPattern);
    assert.match(emitted, /throw result;/);
    const guardIndex = emitted.search(guardPattern);
    const dataAccessIndex = emitted.indexOf('result.data.threads');
    assert.ok(
      guardIndex >= 0 && dataAccessIndex > guardIndex,
      'guard must precede data access',
    );
  });

  test('cursor pagination guards on success status before reading items', () => {
    const pagination: OperationPagination = {
      type: 'cursor',
      items: 'threads',
      hasMore: 'has_more',
      statusCode: 200,
      cursorParamName: 'cursor',
      cursorKeyword: 'cursor',
      limitParamName: 'limit',
      limitKeyword: 'limit',
    };
    const emitted = paginationOperation(pagination);

    assert.match(emitted, guardPattern);
    assert.match(emitted, /throw result;/);
  });

  test('page pagination guards on success status before reading items', () => {
    const pagination: OperationPagination = {
      type: 'page',
      items: 'threads',
      hasMore: 'has_more',
      statusCode: 200,
      pageNumberParamName: 'page',
      pageNumberKeyword: 'page',
      pageSizeParamName: 'pageSize',
      pageSizeKeyword: 'pageSize',
    };
    const emitted = paginationOperation(pagination);

    assert.match(emitted, guardPattern);
    assert.match(emitted, /throw result;/);
  });

  test('uses statusCode from x-pagination metadata', () => {
    const pagination: OperationPagination = {
      type: 'offset',
      items: 'threads',
      hasMore: 'has_more',
      statusCode: 201,
      offsetParamName: 'offset',
      offsetKeyword: 'offset',
      limitParamName: 'limit',
      limitKeyword: 'limit',
    };
    const emitted = paginationOperation(pagination);

    assert.match(emitted, /result\.status\s*!==\s*201/);
  });
});
