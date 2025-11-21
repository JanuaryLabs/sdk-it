import {
  camelcase as _camelcase,
  pascalcase as _pascalcase,
  snakecase as _snakecase,
  spinalcase as _spinalcase,
} from 'stringcase';
import type ts from 'typescript';

import type { TypeDeriver } from './deriver';
import type { ResponseItem } from './paths';

export function removeDuplicates<T>(
  data: T[],
  accessor: (item: T) => T[keyof T] | T = (item) => item,
): T[] {
  return [...new Map(data.map((x) => [accessor(x), x])).values()];
}

export type InferRecordValue<T> = T extends Record<string, infer U> ? U : any;

export function toLitObject<T extends Record<string, any>>(
  obj: T,
  accessor: (value: InferRecordValue<T>) => string = (value) => value,
) {
  return `{${Object.keys(obj)
    .map((key) => `${key}: ${accessor(obj[key])}`)
    .join(', ')}}`;
}

export type NaunceResponseAnalyzerFn = (
  handler: ts.ArrowFunction | ts.FunctionExpression,
  deriver: TypeDeriver,
  node: ts.Node,
) => ResponseItem[];
export type NaunceResponseAnalyzer = Record<string, NaunceResponseAnalyzerFn>;

export type ResponseAnalyzerFn = (
  handler: ts.ArrowFunction | ts.FunctionExpression,
  deriver: TypeDeriver,
) => ResponseItem[];

export function isEmpty(value: unknown): value is null | undefined | '' {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return true;
  }
  return false;
}

export function pascalcase(value: string) {
  return _pascalcase(
    removeSpecialCharsBeforeDigits(value).split('/').join(' '),
  );
}
export function spinalcase(value: string) {
  return _spinalcase(value.split('/').join(' '));
}
export function snakecase(value: string) {
  return _snakecase(value.split('/').join(' '));
}
export function camelcase(value: string): string {
  return _camelcase(removeSpecialCharsBeforeDigits(value));
}
function removeSpecialCharsBeforeDigits(value: string): string {
  return value.replace(/[^A-Za-z0-9]+(?=\d)/g, '');
}

/**
 * Joins an array of strings so that elements containing only digits
 * are concatenated without a separator, while all other elements
 * are prefixed by the separator (unless they're the very first element).
 *
 * @example
 * joinSkipDigits(['foo', '123', 'bar'], '-') // 'foo-123bar'
 */
export function joinSkipDigits(arr: string[], separator: string): string {
  if (arr.length === 0) return '';

  let result = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const el = arr[i];
    // If this element is digits-only, append it directly
    if (/^\d+$/.test(el)) {
      result += el;
    } else {
      // Otherwise, prepend the separator and append the element
      result += separator + el;
    }
  }

  return result;
}

export function exclude<T>(list: T[], exclude: T[]): T[] {
  return list.filter((it) => !exclude.includes(it));
}

/**
 * Sorts an object's keys alphabetically to ensure deterministic output.
 * Creates a new object with keys in alphabetical order.
 *
 * @example
 * sortObjectKeys({ z: 1, a: 2, m: 3 }) // { a: 2, m: 3, z: 1 }
 */
export function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = obj[key];
  }
  return sorted as T;
}

/**
 * Sorts a string array alphabetically to ensure deterministic output.
 *
 * @example
 * sortArray(['z', 'a', 'm']) // ['a', 'm', 'z']
 */
export function sortArray(arr: string[]): string[] {
  return [...arr].sort();
}
