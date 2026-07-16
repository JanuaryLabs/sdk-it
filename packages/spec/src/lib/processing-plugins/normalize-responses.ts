import { iterateOperations } from '../for-each-operation.js';
import { isSuccessStatusCode } from '../is.js';
import type { ProcessingPlugin } from '../processing.js';
import { resolveResponses } from '../tune-response.js';
import type { TunedOperationObject } from '../types.js';

export function normalizeResponses(): ProcessingPlugin {
  return {
    name: 'normalize-responses',
    process({ spec, options, report }) {
      for (const { entry, operation } of iterateOperations(spec)) {
        if (!operation.operationId) {
          throw new Error(
            `Cannot normalize responses before assigning an operation ID for ${entry.method.toUpperCase()} ${entry.path}`,
          );
        }
        const hadSuccessResponse = Object.keys(operation.responses ?? {}).some(
          isSuccessStatusCode,
        );
        (operation as TunedOperationObject).responses = resolveResponses(
          spec,
          operation.operationId,
          operation,
          options.responses,
        );
        if (!hadSuccessResponse) {
          report({
            severity: 'warning',
            code: 'success-response-added',
            message: 'Added a default 200 success response',
            path: `${entry.method.toUpperCase()} ${entry.path}`,
          });
        }
      }
    },
  };
}
