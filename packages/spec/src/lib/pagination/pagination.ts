import type { SchemaObject } from 'openapi3-ts/oas31';

import { isEmpty } from '@sdk-it/core/utils.js';

import type { TunedOperationObject } from '../operation';
import { getHasMoreName, getItemsName } from './pagination-result.js';

interface PaginationResultBase {
  type: 'offset' | 'page' | 'cursor' | 'none';
}

export interface OffsetPaginationResult extends PaginationResultBase {
  type: 'offset';
  offsetParamName: string;
  offsetKeyword: string; // The actual part of param name that matched
  limitParamName: string;
  limitKeyword: string; // The actual part of param name that matched
}

export interface PagePaginationResult extends PaginationResultBase {
  type: 'page';
  pageNumberParamName: string;
  pageNumberKeyword: string;
  pageSizeParamName: string;
  pageSizeKeyword: string;
}

export interface CursorPaginationResult extends PaginationResultBase {
  type: 'cursor';
  cursorParamName: string;
  cursorKeyword: string;
  limitParamName: string;
  limitKeyword: string;
}

export interface NoPaginationResult extends PaginationResultBase {
  type: 'none';
  reason: string;
}

export type PaginationGuess =
  | ((
      | OffsetPaginationResult
      | PagePaginationResult
      | CursorPaginationResult
    ) & { items: string; hasMore: string })
  | NoPaginationResult;

// --- Keyword Regex Definitions ---

export const OFFSET_PARAM_REGEXES: RegExp[] = [
  /\boffset\b/i,
  /\bskip\b/i,
  /\bstart(?:ing_at|_index)?\b/i, // e.g., start, starting_at, start_index
  /\bfrom\b/i,
];

export const GENERIC_LIMIT_PARAM_REGEXES: RegExp[] = [
  /\blimit\b/i,
  /\bcount\b/i,
  /\b(?:page_?)?size\b/i, // e.g., size, page_size, pagesize
  /\bmax_results\b/i,
  /\bnum_results\b/i,
  /\bshow\b/i, // Can sometimes mean limit
  /\bper_?page\b/i, // e.g., per_page, perpage
  /\bper-page\b/i,
  /\btake\b/i,
];

export const PAGE_NUMBER_REGEXES: RegExp[] = [
  /^page$/i, // Exact match for "page"
  /^p$/i, // Exact match for "p" (common shorthand)
  /\bpage_?(?:number|num|idx|index)\b/i, // e.g., page_number, pageNumber, page_num, page_idx
];

// Regexes for parameters indicating page size (when used with page number)
export const PAGE_SIZE_REGEXES: RegExp[] = [
  /\bpage_?size\b/i, // e.g., page_size, pagesize
  /^size$/i, // Exact "size"
  // /\bsize\b/i, // Broader "size" - can be ambiguous, prefer more specific ones first
  /\blimit\b/i, // Limit is often used for page size
  /\bcount\b/i, // Count can also be used for page size
  /\bper_?page\b/i, // e.g., per_page, perpage
  /\bper-page\b/i,
  /\bnum_?(?:items|records|results)\b/i, // e.g., num_items, numitems
  /\bresults_?per_?page\b/i,
];

// Regexes for parameters indicating a cursor
export const CURSOR_REGEXES: RegExp[] = [
  /\bcursor\b/i,
  /\bafter(?:_?cursor)?\b/i, // e.g., after, after_cursor
  /\bbefore(?:_?cursor)?\b/i, // e.g., before, before_cursor
  /\b(next|prev|previous)_?(?:page_?)?token\b/i, // e.g., next_page_token, nextPageToken, prev_token
  /\b(next|prev|previous)_?cursor\b/i, // e.g., next_cursor, previousCursor
  /\bcontinuation(?:_?token)?\b/i, // e.g., continuation, continuation_token
  /\bpage_?token\b/i, // e.g., page_token, pagetoken (often for next page)
  /\bstart_?(?:key|cursor|token|after)\b/i, // e.g., start_key, startCursor, startToken, startAfter
];

// Regexes for parameters indicating a limit when used with cursors
export const CURSOR_LIMIT_REGEXES: RegExp[] = [
  /\blimit\b/i,
  /\bcount\b/i,
  /\bsize\b/i, // General size
  /\bfirst\b/i, // Common in Relay-style cursor pagination (forward pagination)
  /\blast\b/i, // Common in Relay-style cursor pagination (backward pagination)
  /\bpage_?size\b/i, // Sometimes page_size is used with cursors
  /\bnum_?(?:items|records|results)\b/i, // e.g., num_items
  /\bmax_?items\b/i,
  /\btake\b/i,
];

// --- Helper Function ---
function findParamAndKeyword(
  queryParams: { name: string }[],
  regexes: RegExp[],
  excludeParamName?: string,
) {
  for (const param of queryParams) {
    if (param.name === excludeParamName) {
      continue;
    }
    for (const regex of regexes) {
      const match = param.name.match(regex);
      if (match) {
        return { param, keyword: match[0] }; // match[0] is the actual matched substring
      }
    }
  }
  return null;
}

function isOffsetPagination(
  operation: TunedOperationObject,
  parameters: { name: string }[],
): OffsetPaginationResult | null {
  const offsetMatch = findParamAndKeyword(parameters, OFFSET_PARAM_REGEXES);
  if (!offsetMatch) return null;

  const limitMatch = findParamAndKeyword(
    parameters,
    GENERIC_LIMIT_PARAM_REGEXES,
    offsetMatch.param.name,
  );
  if (!limitMatch) return null;

  return {
    type: 'offset',
    offsetParamName: offsetMatch.param.name,
    offsetKeyword: offsetMatch.keyword,
    limitParamName: limitMatch.param.name,
    limitKeyword: limitMatch.keyword,
  };
}

function isPagePagination(
  operation: TunedOperationObject,
): PagePaginationResult | null {
  const queryParams = operation.parameters.filter((p) => p.in === 'query');
  if (queryParams.length < 2) return null;

  const pageNoMatch = findParamAndKeyword(queryParams, PAGE_NUMBER_REGEXES);
  if (!pageNoMatch) return null;

  const pageSizeMatch = findParamAndKeyword(
    queryParams,
    PAGE_SIZE_REGEXES,
    pageNoMatch.param.name,
  );
  if (!pageSizeMatch) return null;

  return {
    type: 'page',
    pageNumberParamName: pageNoMatch.param.name,
    pageNumberKeyword: pageNoMatch.keyword,
    pageSizeParamName: pageSizeMatch.param.name,
    pageSizeKeyword: pageSizeMatch.keyword,
  };
}

function isCursorPagination(
  operation: TunedOperationObject,
): CursorPaginationResult | null {
  const queryParams = operation.parameters.filter((p) => p.in === 'query');
  if (queryParams.length < 2) return null; // Need at least a cursor and a limit-like param

  const cursorMatch = findParamAndKeyword(queryParams, CURSOR_REGEXES);
  if (!cursorMatch) return null;

  const limitMatch = findParamAndKeyword(
    queryParams,
    CURSOR_LIMIT_REGEXES,
    cursorMatch.param.name,
  );
  if (!limitMatch) return null;

  return {
    type: 'cursor',
    cursorParamName: cursorMatch.param.name,
    cursorKeyword: cursorMatch.keyword,
    limitParamName: limitMatch.param.name,
    limitKeyword: limitMatch.keyword,
  };
}

/**
 * Guesses the pagination strategy of an OpenAPI operation based on its query parameters.
 * It checks for offset, page-based, and cursor-based pagination in that order.
 *
 * @param operation The OpenAPI operation object.
 * @returns A PaginationGuess object indicating the detected type and relevant parameters.
 */
export function guessPagination(
  operation: TunedOperationObject,
  body?: SchemaObject,
  response?: SchemaObject,
): PaginationGuess {
  const bodyParameters =
    body && body.properties
      ? Object.keys(body.properties).map((it) => ({ name: it }))
      : [];
  const parameters = operation.parameters;
  if (isEmpty(operation.parameters) && isEmpty(bodyParameters)) {
    return { type: 'none', reason: 'no parameters' };
  }
  if (!response) {
    return { type: 'none', reason: 'no response' };
  }
  if (!response.properties) {
    return { type: 'none', reason: 'empty response' };
  }
  const properties = response.properties as Record<string, SchemaObject>;

  const itemsKey = getItemsName(properties);
  if (!itemsKey) {
    return { type: 'none', reason: 'no items key' };
  }
  const hasMoreKey = getHasMoreName(excludeKey(properties, itemsKey));

  if (!hasMoreKey) {
    return { type: 'none', reason: 'no hasMore key' };
  }
  const pagination =
    isOffsetPagination(operation, [...parameters, ...bodyParameters]) ||
    isPagePagination(operation) ||
    isCursorPagination(operation);
  return pagination
    ? { ...pagination, items: itemsKey, hasMore: hasMoreKey }
    : { type: 'none', reason: 'no pagination' };
}

function excludeKey<T extends Record<string, any>>(
  obj: T,
  key: string,
): Omit<T, typeof key> {
  const { [key]: _, ...rest } = obj;
  return rest;
}
