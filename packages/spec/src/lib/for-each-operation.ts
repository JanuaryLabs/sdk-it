import type { OperationObject, PathItemObject } from 'openapi3-ts/oas31';

import { type Method, methods } from '@sdk-it/core/paths.js';

import type { IR, OperationEntry, TunedOperationObject } from './types.js';

export interface IteratedOperation {
  entry: Omit<OperationEntry, 'method' | 'tag'> & {
    method: Method;
    tag?: string;
  };
  operation: OperationObject;
  pathItem: PathItemObject;
}

export function* iterateOperations(spec: IR): Generator<IteratedOperation> {
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      yield {
        entry: {
          method,
          path,
          tag: operation.tags?.[0],
        },
        operation,
        pathItem,
      };
    }
  }
}

export function forEachOperation<T>(
  spec: IR,
  callback: (entry: OperationEntry, operation: TunedOperationObject) => T,
) {
  const result: T[] = [];
  for (const { entry, operation } of iterateOperations(spec)) {
    result.push(
      callback(entry as OperationEntry, operation as TunedOperationObject),
    );
  }
  return result;
}
