import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import { type ZodType, z } from 'zod';

import { followRef, isEmpty, isRef } from '@sdk-it/core';
import type { IR } from '@sdk-it/spec';

// z.iso.time() rejects RFC 3339 zone suffixes ('10:30:00Z', '10:30:00+02:00'),
// which JSON Schema's format: time allows. Accept both local and
// zone-qualified times.
const isoTime = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?$/,
  );

/**
 * Convert an OpenAPI (JSON Schema style) object into a runtime Zod schema,
 */
export class RuntimeZodConverter {
  readonly #spec: IR;

  constructor(spec: IR) {
    this.#spec = spec;
  }

  #object(schema: SchemaObject): ZodType {
    const properties = schema.properties || {};
    const required = schema.required || [];

    // Convert each property
    const shape: Record<string, ZodType> = {};

    for (const [key, propSchema] of Object.entries(properties)) {
      const isRequired = required.includes(key);
      shape[key] = this.handle(propSchema, isRequired);
    }

    let result = z.object(shape);

    // Handle additional properties
    if (schema.additionalProperties) {
      if (typeof schema.additionalProperties === 'object') {
        const addPropSchema = this.handle(schema.additionalProperties, true);
        result = result.catchall(addPropSchema);
      } else if (schema.additionalProperties === true) {
        result = result.catchall(z.unknown());
      }
    }

    return result;
  }

  #array(schema: SchemaObject): ZodType {
    const { items } = schema;
    if (!items) {
      let result: ZodType = z.array(z.unknown());

      // Apply default if present
      if (schema.default !== undefined) {
        result = z.array(z.unknown()).default(schema.default);
      }

      return result;
    }

    // If items is an array => tuple
    if (Array.isArray(items)) {
      const tupleItems = items.map((sub) => this.handle(sub, true));
      return z.tuple(tupleItems as [ZodType, ...ZodType[]]);
    }

    // If items is a single schema => standard z.array(...)
    const itemsSchema = this.handle(items, true);
    let result: ZodType = z.array(itemsSchema);

    // Apply default if present
    if (schema.default !== undefined) {
      result = z.array(itemsSchema).default(schema.default);
    }

    return result;
  }

  #ref($ref: string): ZodType {
    const resolvedSchema = followRef(this.#spec, $ref);
    const zodSchema = this.handle(resolvedSchema, true);
    return zodSchema;
  }

  #toIntersection(schemas: ZodType[]): ZodType {
    const [left, ...right] = schemas;
    if (!right.length) {
      return left;
    }
    return z.intersection(left, this.#toIntersection(right));
  }

  allOf(schemas: (SchemaObject | ReferenceObject)[]): ZodType {
    const allOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (allOfSchemas.length === 0) {
      return z.unknown();
    }
    if (allOfSchemas.length === 1) {
      return allOfSchemas[0];
    }
    return this.#toIntersection(allOfSchemas);
  }

  anyOf(schemas: (SchemaObject | ReferenceObject)[]): ZodType {
    const anyOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (anyOfSchemas.length === 1) {
      return anyOfSchemas[0];
    }
    return z.union(anyOfSchemas);
  }

  oneOf(schemas: (SchemaObject | ReferenceObject)[]): ZodType {
    const oneOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (oneOfSchemas.length === 1) {
      return oneOfSchemas[0];
    }
    // oneOf is exclusive-or per JSON Schema; z.xor rejects values matching
    // more than one branch, unlike z.union's anyOf semantics.
    return z.xor(oneOfSchemas);
  }

  enum(type: string, values: unknown[]): ZodType {
    if (values.length === 1) {
      return z.literal(values[0] as z.core.util.Literal);
    }
    // z.enum only supports string values; zod 4 silently filters numeric
    // entries as reverse mappings, so any non-string enum must be a literal.
    if (values.every((value) => typeof value === 'string')) {
      return z.enum(values as string[]);
    }
    return z.literal(values as z.core.util.Literal[]);
  }

  /**
   * Handle a `string` schema with possible format keywords (JSON Schema).
   */
  string(schema: SchemaObject): ZodType {
    if (schema.contentEncoding === 'binary') {
      // Bare z.custom (no predicate) on purpose: referencing Blob as a
      // runtime value throws ReferenceError in environments without the
      // global, and cross-realm/polyfill Blobs fail instanceof checks
      // (see e62c4e1 and docs/recipes/file-upload.md). Bad inputs surface
      // in fetch/FormData instead.
      return z.custom<Blob>();
    }

    const coerced = schema['x-zod-type'] === 'coerce-string';
    const base = coerced ? z.coerce.string() : z.string();
    const withFormat = (format: ZodType<string, string>): ZodType =>
      coerced ? base.pipe(format) : format;

    switch (schema.format) {
      case 'date-time':
      case 'datetime':
        if (schema['x-zod-type'] === 'coerce-date') {
          return z.coerce.date();
        } else if (schema['x-zod-type'] === 'date') {
          return z.date();
        } else {
          // RFC 3339 date-time allows numeric zone offsets, which
          // z.iso.datetime() rejects by default.
          return withFormat(z.iso.datetime({ offset: true }));
        }
      case 'date':
        return withFormat(z.iso.date());
      case 'time':
        return withFormat(isoTime);
      case 'email':
        return withFormat(z.email());
      case 'uuid':
        // z.guid() preserves zod v3's looser .uuid() semantics; z.uuid()
        // enforces RFC 9562 variant bits and rejects Microsoft-style GUIDs.
        return withFormat(z.guid());
      case 'url':
      case 'uri':
        return withFormat(z.url());
      case 'ipv4':
        return withFormat(z.ipv4());
      case 'ipv6':
        return withFormat(z.ipv6());
      case 'cidrv4':
        return withFormat(z.cidrv4());
      case 'cidrv6':
        return withFormat(z.cidrv6());
      case 'byte':
      case 'binary':
        // Bare z.custom on purpose — see the contentEncoding branch above.
        return z.custom<Blob>();
      default:
        // No special format
        return base;
    }
  }

  /**
   * Handle number/integer constraints from OpenAPI/JSON Schema.
   */
  #number(schema: SchemaObject): ZodType {
    let base =
      schema['x-zod-type'] === 'coerce-number' ? z.coerce.number() : z.number();

    if (schema.type === 'integer' || schema.format === 'int32') {
      base = base.int();
    }

    // Exclusive bounds
    if (typeof schema.exclusiveMinimum === 'number') {
      base = base.gt(schema.exclusiveMinimum);
    }

    if (typeof schema.exclusiveMaximum === 'number') {
      base = base.lt(schema.exclusiveMaximum);
    }

    // Inclusive bounds
    if (typeof schema.minimum === 'number') {
      base = base.min(schema.minimum);
    }

    if (typeof schema.maximum === 'number') {
      base = base.max(schema.maximum);
    }

    // multipleOf
    if (typeof schema.multipleOf === 'number') {
      const multipleOf = schema.multipleOf;
      return base.refine(
        (val) => Number.isInteger(Number(val) / multipleOf),
        `Must be a multiple of ${multipleOf}`,
      );
    }

    return base;
  }

  /**
   * Convert a basic type to Zod schema with proper chaining
   */
  normal(
    type: string,
    schema: SchemaObject,
    required = false,
    nullable = false,
  ): ZodType {
    let base: ZodType;

    switch (type) {
      case 'string':
        base = this.string(schema);
        break;
      case 'number':
      case 'integer':
        base = this.#number(schema);
        break;
      case 'boolean':
        // z.stringbool parses boolean-ish strings ('true'/'1'/'yes'...)
        // semantically; zod's Boolean(x) coercion turns 'false' into true.
        base =
          schema['x-zod-type'] === 'coerce-boolean'
            ? z.union([z.boolean(), z.stringbool()])
            : z.boolean();
        break;
      case 'object':
        base = this.#object(schema);
        break;
      case 'array':
        base = this.#array(schema);
        break;
      case 'null':
        base = z.null();
        break;
      default:
        base = z.unknown();
        break;
    }

    // Apply nullable to the base type before optional/default wrapping.
    if (nullable) {
      base = base.nullable();
    }

    if (!required) {
      base = base.optional();
    }

    if (schema.default !== undefined) {
      const defaultValue =
        (schema['x-zod-type'] === 'date' ||
          schema['x-zod-type'] === 'coerce-date') &&
        schema.default
          ? new Date(schema.default)
          : schema.default;
      base = base.default(defaultValue);
    }

    // Handle x-prefix transform (this should be last)
    if (schema['x-prefix']) {
      const prefix = schema['x-prefix'];
      if (!required) {
        base = base.transform((val) => (val ? `${prefix}${val}` : undefined));
      } else {
        base = base.transform((val) => `${prefix}${val}`);
      }
    }

    return base;
  }

  handle(schema: SchemaObject | ReferenceObject, required = false): ZodType {
    // Handle reference
    if (isRef(schema)) {
      let result = this.#ref(schema.$ref);
      if (!required) {
        result = result.optional();
      }
      if (schema.description) {
        result = result.describe(schema.description);
      }
      return result;
    }

    let result: ZodType = z.unknown();

    if (schema.not && isEmpty(schema.not)) {
      result = required ? z.never() : z.never().optional();
    }

    // Handle allOf → intersection
    else if (schema.allOf && Array.isArray(schema.allOf)) {
      result = this.allOf(schema.allOf);
      if (!required) {
        result = result.optional();
      }
    }

    // anyOf → union
    else if (schema.anyOf && Array.isArray(schema.anyOf)) {
      result = this.anyOf(schema.anyOf);
      if (!required) {
        result = result.optional();
      }
    }

    // oneOf → union
    else if (
      schema.oneOf &&
      Array.isArray(schema.oneOf) &&
      schema.oneOf.length
    ) {
      result = this.oneOf(schema.oneOf);
      if (!required) {
        result = result.optional();
      }
    }

    // enum
    else if (schema.enum && Array.isArray(schema.enum)) {
      result = this.enum(schema.type as string, schema.enum);

      // Apply default if it exists and is in the enum. Only for required
      // schemas: the optional wrapper below must keep shadowing the default
      // (zod v3 semantics), while zod v4 would surface it through .optional().
      if (
        schema.default !== undefined &&
        schema.enum.includes(schema.default) &&
        required
      ) {
        result = result.default(schema.default);
      }

      if (!required) {
        result = result.optional();
      }
    } else {
      // Parse types (can be string or array in OpenAPI 3.1)
      const types = Array.isArray(schema.type)
        ? schema.type
        : schema.type
          ? [schema.type]
          : [];

      // Backward compatibility with OpenAPI 3.0 nullable
      if ('nullable' in schema && schema.nullable) {
        types.push('null');
      } else if (schema.default === null) {
        types.push('null');
      }

      // If no explicit "type", fallback to unknown
      if (!types.length) {
        result = required ? z.unknown() : z.unknown().optional();
      }

      // Handle union types
      else if (types.length > 1) {
        const realTypes = types.filter((t) => t !== 'null');
        if (realTypes.length === 1 && types.includes('null')) {
          // Single real type + "null"
          result = this.normal(realTypes[0], schema, required, true);
        } else {
          // Multiple different types, build a union
          result = z.union(types.map((t) => this.normal(t, schema, true)));
          if (!required) {
            result = result.optional();
          }
        }
      } else {
        result = this.normal(types[0], schema, required, false);
      }
    }

    if (schema.description) {
      result = result.describe(schema.description);
    }

    return result;
  }
}

/**
 * Convert a runtime SchemaObject to a Zod schema
 */
export function schemaToZod(
  schema: SchemaObject,
  spec: IR,
  options?: {
    required?: boolean;
  },
): ZodType {
  const converter = new RuntimeZodConverter(spec);
  return converter.handle(schema, options?.required ?? false);
}
