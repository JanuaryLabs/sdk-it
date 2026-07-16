import { snakecase } from '@sdk-it/core/utils.js';

import { iterateOperations } from '../for-each-operation.js';
import type { ProcessingPlugin } from '../processing.js';

export function normalizeTags(): ProcessingPlugin {
  return {
    name: 'normalize-tags',
    process({ spec, options }) {
      for (const { entry, operation } of iterateOperations(spec)) {
        const tag = options.tag(operation, entry.path);
        operation['x-fn-group'] = tag;
        operation.tags = [snakecase(tag)];
      }
    },
  };
}
