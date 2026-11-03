import type { OperationObject, PathItemObject } from 'openapi3-ts/oas31';

import { type Method, methods } from '@sdk-it/core/paths.js';

import type {
  IR,
  OperationEntry,
  ProcessingDocument,
  TunedOperationObject,
} from './types.js';

export interface IteratedOperation {
  entry: Omit<OperationEntry, 'method' | 'tag'> & {
    method: Method;
    tag?: string;
  };
  operation: OperationObject;
  pathItem: PathItemObject;
}

/** Iterates the raw operations a document-stage plugin rewrites. */
export function* iterateOperations(
  spec: Pick<ProcessingDocument, 'paths'>,
): Generator<IteratedOperation> {
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
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }
      const [tag] = operation.tags;
      result.push(callback({ method, path, tag }, operation));
    }
  }
  return result;
}
