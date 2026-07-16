import type { SchemaObject } from 'openapi3-ts/oas31';

import type { ProcessingPlugin } from '../processing.js';
import { expandSpec } from '../tune.js';

export function extractInlineSchemas(): ProcessingPlugin {
  return {
    name: 'extract-inline-schemas',
    process({ spec }) {
      const refs: { name: string; value: SchemaObject }[] = [];
      expandSpec(spec, spec.components.schemas, refs);
    },
  };
}
