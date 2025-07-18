import type { OperationObject } from 'openapi3-ts/oas31';

import { type Method, methods } from '@sdk-it/core/paths.js';

import type { IR, OperationEntry, TunedOperationObject } from './types.js';

export function forEachOperation<T>(
  spec: IR,
  callback: (entry: OperationEntry, operation: TunedOperationObject) => T,
) {
  const result: T[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem) as [
      Method,
      OperationObject,
    ][]) {
      if (!methods.includes(method)) {
        continue;
      }
      const operationTag = operation.tags?.[0] as string;

      result.push(
        callback(
          {
            method,
            path: path,
            tag: operationTag,
          },
          operation as TunedOperationObject,
        ),
      );
    }
  }
  return result;
}
