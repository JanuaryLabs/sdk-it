import type { SchemaObject } from 'openapi3-ts/oas31';

import type { OpenAPIDocument } from '@sdk-it/core';
import { followRef, isRef, resolveRef } from '@sdk-it/core/ref.js';

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
  return (
    isPrimitiveSchema(target) &&
    !reaches(spec, target, $ref, new Set(), isPrimitiveSchema)
  );
}

/**
 * Whether the component `$ref` points at refers back to itself through other
 * components, so a generator must defer the reference that closes the cycle.
 */
export function isRecursiveRef(spec: OpenAPIDocument, $ref: string): boolean {
  return reaches(
    spec,
    followRef<SchemaObject>(spec, $ref),
    $ref,
    new Set(),
    () => true,
  );
}

/** Whether `schema` refers to `$ref`, following each component `through` accepts. */
function reaches(
  spec: OpenAPIDocument,
  schema: SchemaObject,
  $ref: string,
  seen: Set<string>,
  through: (component: SchemaObject) => boolean,
): boolean {
  for (const [, child] of subschemas(schema)) {
    if (!isRef(child)) {
      if (reaches(spec, child, $ref, seen, through)) return true;
      continue;
    }
    if (child.$ref === $ref) return true;
    if (seen.has(child.$ref)) continue;
    seen.add(child.$ref);
    const target = followRef<SchemaObject>(spec, child.$ref);
    if (through(target) && reaches(spec, target, $ref, seen, through)) {
      return true;
    }
  }
  return false;
}

/**
 * The property that selects the branch of `schema`'s `oneOf` or `anyOf`, when
 * the branches are objects that require it and each gives it values no other
 * branch gives, so at most one branch can match any value. A generator may
 * then validate by that property, since OpenAPI 3.2 says a `discriminator`
 * MUST NOT change the validation outcome. Branches that leave the property
 * open, as the Pet store's `petType: { type: 'string' }`, give `undefined`.
 */
export function discriminatorOf(
  spec: OpenAPIDocument,
  schema: SchemaObject,
): string | undefined {
  const propertyName = schema.discriminator?.propertyName;
  // Both together keep JSON Schema's meaning of each, which no one zod union has.
  if (schema.oneOf && schema.anyOf) return undefined;
  const branches = schema.oneOf ?? schema.anyOf;
  if (typeof propertyName !== 'string' || !branches?.length) return undefined;
  const seen = new Set<unknown>();
  for (const branch of branches) {
    const values = discriminatorValues(
      spec,
      resolveRef(spec, branch),
      propertyName,
    );
    if (!values) return undefined;
    for (const value of values) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
  }
  return propertyName;
}

/** The literal values `branch` gives `propertyName`, when `branch` is an object that requires it. */
function discriminatorValues(
  spec: OpenAPIDocument,
  branch: SchemaObject,
  propertyName: string,
): unknown[] | undefined {
  if (
    branch.type !== 'object' ||
    ('nullable' in branch && branch.nullable) ||
    branch.default !== undefined ||
    branch.allOf ||
    branch.anyOf ||
    branch.oneOf ||
    !branch.required?.includes(propertyName)
  ) {
    return undefined;
  }
  const property = branch.properties?.[propertyName];
  if (!property) return undefined;
  const { const: value, enum: values } = resolveRef(spec, property);
  const literals =
    value !== undefined ? [value] : values?.length ? values : undefined;
  return literals?.every(isLiteral) ? literals : undefined;
}

/** A value `z.literal` takes as a discriminator. */
function isLiteral(value: unknown): boolean {
  return (
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  );
}
