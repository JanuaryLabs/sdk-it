import type { ParameterObject, PathItemObject } from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core/ref.js';

import { iterateOperations } from '../for-each-operation.js';
import type { ProcessingPlugin } from '../processing.js';

export function normalizeParameters(): ProcessingPlugin {
  return {
    name: 'normalize-parameters',
    process({ spec }) {
      const pathItems = new Set<PathItemObject>();
      for (const { operation, pathItem } of iterateOperations(spec)) {
        pathItems.add(pathItem);
        const parameters = new Map<string, ParameterObject>();
        for (const parameterOrRef of [
          ...(pathItem.parameters ?? []),
          ...(operation.parameters ?? []),
        ]) {
          const parameter = resolveRef<ParameterObject>(spec, parameterOrRef);
          parameters.set(`${parameter.in}:${parameter.name}`, parameter);
        }
        operation.parameters = [...parameters.values()];
      }
      for (const pathItem of pathItems) {
        delete pathItem.parameters;
      }
    },
  };
}
