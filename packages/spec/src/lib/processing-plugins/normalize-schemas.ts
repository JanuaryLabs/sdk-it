import type { ProcessingPlugin } from '../processing.js';
import { fixSpec } from '../tune.js';

export function normalizeSchemas(): ProcessingPlugin {
  return {
    name: 'normalize-schemas',
    process({ spec }) {
      fixSpec(spec, Object.values(spec.components.schemas));
    },
  };
}
