import type { SchemaObject } from 'openapi3-ts/oas31';

import type { OpenAPIDocument } from '@sdk-it/core';
import { followRef, isRef } from '@sdk-it/core/ref.js';

import { coerceTypes } from './is.js';
import { subschemas } from './walk-schemas.js';

export function isPrimitiveSchema(schema: SchemaObject) {
  const types = coerceTypes(schema, false);
  if (!types || types.length === 0) {
    return false;
  }
  return types.includes('object') === false;
}

/**
 * Whether a generator may write the component `$ref` points at in place
 * instead of naming it: a primitive that does not reach itself through other
 * primitives, since inlining a cycle never ends.
 */
export function isInlinable(spec: OpenAPIDocument, $ref: string): boolean {
  const target = followRef<SchemaObject>(spec, $ref);
  return isPrimitiveSchema(target) && !reaches(spec, target, $ref, new Set());
}

function reaches(
  spec: OpenAPIDocument,
  schema: SchemaObject,
  $ref: string,
  seen: Set<string>,
): boolean {
  for (const [, child] of subschemas(schema)) {
    if (!isRef(child)) {
      if (reaches(spec, child, $ref, seen)) return true;
      continue;
    }
    if (child.$ref === $ref) return true;
    if (seen.has(child.$ref)) continue;
    seen.add(child.$ref);
    const target = followRef<SchemaObject>(spec, child.$ref);
    if (isPrimitiveSchema(target) && reaches(spec, target, $ref, seen)) {
      return true;
    }
  }
  return false;
}
