import type { SchemaObject } from 'openapi3-ts/oas31';

import { coerceTypes } from './tune.js';

export function isPrimitiveSchema(schema: SchemaObject) {
  const types = coerceTypes(schema, false);
  if (!types || types.length === 0) {
    return false;
  }
  return types.includes('object') === false;
}
