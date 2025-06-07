import {
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
  handler: ts.ArrowFunction,
  deriver: TypeDeriver,
  node: ts.Node,
) => ResponseItem[];
export type NaunceResponseAnalyzer = Record<string, NaunceResponseAnalyzerFn>;

export type ResponseAnalyzerFn = (
  handler: ts.ArrowFunction,
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
  return _pascalcase(value.split('/').join(' '));
}
export function spinalcase(value: string) {
  return _spinalcase(value.split('/').join(' '));
}
export function snakecase(value: string) {
  return _snakecase(value.split('/').join(' '));
}

/**
 * Joins an array of strings so that elements containing only digits
 * are concatenated without a separator, while all other elements
 * are prefixed by the separator (unless they're the very first element).
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
