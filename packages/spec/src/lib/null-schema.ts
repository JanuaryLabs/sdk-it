import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { type OpenAPIDocument, resolveRef } from '@sdk-it/core';

/** Whether `schema` is the null schema (`type: 'null'`) once its $ref is followed. */
export function isNullSchema(
  spec: OpenAPIDocument,
  schema: SchemaObject | ReferenceObject,
): boolean {
  return resolveRef<SchemaObject>(spec, schema).type === 'null';
}
