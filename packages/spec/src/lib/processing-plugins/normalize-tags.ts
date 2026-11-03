import { snakecase } from '@sdk-it/core/utils.js';

import { iterateOperations } from '../for-each-operation.js';
import type { DocumentPlugin } from '../processing.js';

export function normalizeTags(): DocumentPlugin {
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
