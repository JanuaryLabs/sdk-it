import type { SchemaObject } from 'openapi3-ts/oas31';

import type { IRPlugin } from '../processing.js';
import { walkSchemas } from '../walk-schemas.js';

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

export function canonicalizeSpec(): IRPlugin {
  return {
    name: 'canonicalize-spec',
    process({ spec }) {
      spec.components.schemas = sortRecord(spec.components.schemas);
      for (const { schema } of walkSchemas(spec)) {
        if (schema.properties) {
          schema.properties = sortRecord(schema.properties);
        }
        const extraProperties: Record<string, SchemaObject> | undefined =
          schema['x-properties'];
        if (extraProperties) {
          schema['x-properties'] = sortRecord(extraProperties);
        }
      }
    },
  };
}
