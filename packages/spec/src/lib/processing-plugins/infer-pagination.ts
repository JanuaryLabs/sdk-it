import { forEachOperation } from '../for-each-operation.js';
import { toPagination } from '../pagination/pagination.js';
import type { ProcessingPlugin } from '../processing.js';

export function inferPagination(): ProcessingPlugin {
  return {
    name: 'infer-pagination',
    process({ spec, options }) {
      forEachOperation(spec, (_entry, operation) => {
        if (options.pagination.enabled && options.pagination.guess) {
          operation['x-pagination'] = toPagination(spec, operation);
        } else {
          delete operation['x-pagination'];
        }
      });
    },
  };
}
