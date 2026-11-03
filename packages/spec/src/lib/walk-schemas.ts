import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { isRef } from '@sdk-it/core/ref.js';

import type { IR } from './types.js';

export interface WalkedSchema {
  schema: SchemaObject;
  pointer: string;
}

function escapePointerSegment(segment: string) {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Each schema `schema` nests directly, with its pointer segment. */
export function* subschemas(
  schema: SchemaObject,
): Generator<[segment: string, child: SchemaObject | ReferenceObject]> {
  for (const key of ['properties', 'x-properties'] as const) {
    const properties = schema[key] as
      Record<string, SchemaObject | ReferenceObject> | undefined;
    for (const [name, property] of Object.entries(properties ?? {})) {
      yield [`${key}/${escapePointerSegment(name)}`, property];
    }
  }

  for (const key of [
    'items',
    'not',
    'additionalProperties',
    'propertyNames',
  ] as const) {
    const child = schema[key];
    if (typeof child === 'object' && child !== null) {
      yield [key, child];
    }
  }

  for (const key of ['allOf', 'oneOf', 'anyOf', 'prefixItems'] as const) {
    for (const [index, child] of (schema[key] ?? []).entries()) {
      yield [`${key}/${index}`, child];
    }
  }
}

function* walkSchema(
  schema: SchemaObject | ReferenceObject,
  pointer: string,
  visited: WeakSet<SchemaObject>,
): Generator<WalkedSchema> {
  if (isRef(schema) || visited.has(schema)) {
    return;
  }

  visited.add(schema);
  yield { schema, pointer };

  for (const [segment, child] of subschemas(schema)) {
    yield* walkSchema(child, `${pointer}/${segment}`, visited);
  }
}

export function* walkSchemas(spec: IR): Generator<WalkedSchema> {
  const visited = new WeakSet<SchemaObject>();
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    yield* walkSchema(
      schema,
      `#/components/schemas/${escapePointerSegment(name)}`,
      visited,
    );
  }
}
