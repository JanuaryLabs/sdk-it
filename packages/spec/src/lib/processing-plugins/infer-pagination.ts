import { iterateOperations } from '../for-each-operation.js';
import { toPagination } from '../pagination/pagination.js';
import type { ProcessingPlugin } from '../processing.js';
import type { TunedOperationObject } from '../types.js';

export function inferPagination(): ProcessingPlugin {
  return {
    name: 'infer-pagination',
    process({ spec, options }) {
      for (const { operation } of iterateOperations(spec)) {
        const tunedOperation = operation as TunedOperationObject;
        if (options.pagination.enabled && options.pagination.guess) {
          tunedOperation['x-pagination'] = toPagination(spec, tunedOperation);
        } else {
          delete tunedOperation['x-pagination'];
        }
      }
    },
  };
}
