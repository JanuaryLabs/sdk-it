import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import { type ZodSchema, type ZodTypeAny, z } from 'zod';

import { followRef, isRef } from '@sdk-it/core';
import type { IR } from '@sdk-it/spec';

/**
 * Convert an OpenAPI (JSON Schema style) object into a runtime Zod schema,
 */
export class RuntimeZodConverter {
  readonly #spec: IR;

  constructor(spec: IR) {
    this.#spec = spec;
  }

  #object(schema: SchemaObject): ZodSchema {
    const properties = schema.properties || {};
    const required = schema.required || [];

    // Convert each property
    const shape: Record<string, ZodTypeAny> = {};

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

  #array(schema: SchemaObject): ZodSchema {
    const { items } = schema;
    if (!items) {
      let result: ZodSchema = z.array(z.unknown());

      // Apply default if present
      if (schema.default !== undefined) {
        result = z.array(z.unknown()).default(schema.default);
      }

      return result;
    }

    // If items is an array => tuple
    if (Array.isArray(items)) {
      const tupleItems = items.map((sub) => this.handle(sub, true));
      return z.tuple(tupleItems as [ZodTypeAny, ...ZodTypeAny[]]);
    }

    // If items is a single schema => standard z.array(...)
    const itemsSchema = this.handle(items, true);
    let result: ZodSchema = z.array(itemsSchema);

    // Apply default if present
    if (schema.default !== undefined) {
      result = z.array(itemsSchema).default(schema.default);
    }

    return result;
  }

  #ref($ref: string): ZodSchema {
    const resolvedSchema = followRef(this.#spec, $ref);
    const zodSchema = this.handle(resolvedSchema, true);
    return zodSchema;
  }

  #toIntersection(schemas: ZodSchema[]): ZodSchema {
    const [left, ...right] = schemas;
    if (!right.length) {
      return left;
    }
    return z.intersection(left, this.#toIntersection(right));
  }

  allOf(schemas: (SchemaObject | ReferenceObject)[]): ZodSchema {
    const allOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (allOfSchemas.length === 0) {
      return z.unknown();
    }
    if (allOfSchemas.length === 1) {
      return allOfSchemas[0];
    }
    return this.#toIntersection(allOfSchemas);
  }

  anyOf(schemas: (SchemaObject | ReferenceObject)[]): ZodSchema {
    const anyOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (anyOfSchemas.length === 1) {
      return anyOfSchemas[0];
    }
    return z.union(anyOfSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  oneOf(schemas: (SchemaObject | ReferenceObject)[]): ZodSchema {
    const oneOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (oneOfSchemas.length === 1) {
      return oneOfSchemas[0];
    }
    return z.union(oneOfSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  enum(type: string, values: unknown[]): ZodSchema {
    if (values.length === 1) {
      return z.literal(values[0] as z.Primitive);
    }
    if (type === 'integer') {
      // Ensure we have at least 2 values for union
      if (values.length >= 2) {
        const [first, second, ...rest] = values.map((val) =>
          z.literal(val as z.Primitive),
        );
        return z.union([first, second, ...rest]);
      }
      return z.literal(values[0] as z.Primitive);
    }

    // For string enums, ensure we have the correct type
    const stringValues = values as string[];
    if (stringValues.length >= 2) {
      const [first, ...rest] = stringValues;
      return z.enum([first, ...rest] as [string, ...string[]]);
    }
    return z.literal(stringValues[0] as z.Primitive);
  }

  /**
   * Handle a `string` schema with possible format keywords (JSON Schema).
   */
  string(schema: SchemaObject): ZodSchema {
    if (schema.contentEncoding === 'binary') {
      return z.instanceof(Blob);
    }

    const base =
      schema['x-zod-type'] === 'coerce-string' ? z.coerce.string() : z.string();

    switch (schema.format) {
      case 'date-time':
      case 'datetime':
        if (schema['x-zod-type'] === 'coerce-date') {
          return z.coerce.date();
        } else if (schema['x-zod-type'] === 'date') {
          return z.date();
        } else {
          return base.datetime();
        }
      case 'date':
        return base.date();
      case 'time':
        return base; // Could add regex for HH:MM:SS format
      case 'email':
        return base.email();
      case 'uuid':
        return base.uuid();
      case 'url':
      case 'uri':
        return base.url();
      case 'ipv4':
        return base.ip({ version: 'v4' });
      case 'ipv6':
        return base.ip({ version: 'v6' });
      case 'byte':
      case 'binary':
        return z.instanceof(Blob);
      case 'int64':
        // JS numbers can't reliably store int64, keep as string or use bigint
        return base;
      default:
        // No special format
        return base;
    }
  }

  /**
   * Handle number/integer constraints from OpenAPI/JSON Schema.
   */
  #number(schema: SchemaObject): ZodSchema {
    if (schema.format === 'int64') {
      let base: ZodSchema =
        schema['x-zod-type'] === 'coerce-bigint'
          ? z.coerce.bigint()
          : z.bigint();

      // Exclusive bounds
      if (typeof schema.exclusiveMinimum === 'number') {
        base = (base as z.ZodBigInt).gt(BigInt(schema.exclusiveMinimum));
      }

      if (typeof schema.exclusiveMaximum === 'number') {
        base = (base as z.ZodBigInt).lt(BigInt(schema.exclusiveMaximum));
      }

      if (typeof schema.minimum === 'number') {
        base = (base as z.ZodBigInt).min(BigInt(schema.minimum));
      }

      if (typeof schema.maximum === 'number') {
        base = (base as z.ZodBigInt).max(BigInt(schema.maximum));
      }

      return base;
    }

    let base: ZodSchema =
      schema['x-zod-type'] === 'coerce-number' ? z.coerce.number() : z.number();

    if (schema.type === 'integer' || schema.format === 'int32') {
      base = (base as z.ZodNumber).int();
    }

    // Exclusive bounds
    if (typeof schema.exclusiveMinimum === 'number') {
      base = (base as z.ZodNumber).gt(schema.exclusiveMinimum);
    }

    if (typeof schema.exclusiveMaximum === 'number') {
      base = (base as z.ZodNumber).lt(schema.exclusiveMaximum);
    }

    // Inclusive bounds
    if (typeof schema.minimum === 'number') {
      base = (base as z.ZodNumber).min(schema.minimum);
    }

    if (typeof schema.maximum === 'number') {
      base = (base as z.ZodNumber).max(schema.maximum);
    }

    // multipleOf
    if (typeof schema.multipleOf === 'number') {
      const multipleOf = schema.multipleOf;
      base = base.refine(
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
  ): ZodSchema {
    let base: ZodSchema;

    switch (type) {
      case 'string':
        base = this.string(schema);
        break;
      case 'number':
      case 'integer':
        base = this.#number(schema);
        break;
      case 'boolean':
        base =
          schema['x-zod-type'] === 'coerce-boolean'
            ? z.coerce.boolean()
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
        schema.format === 'int64'
          ? BigInt(schema.default)
          : (schema['x-zod-type'] === 'date' ||
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

  handle(schema: SchemaObject | ReferenceObject, required = false): ZodSchema {
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

    let result: ZodSchema = z.unknown();

    // Handle allOf → intersection
    if (schema.allOf && Array.isArray(schema.allOf)) {
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

      // Apply default if it exists and is in the enum
      if (
        schema.default !== undefined &&
        schema.enum.includes(schema.default)
      ) {
        // Rebuild the enum schema with default to avoid type issues
        const defaultValue = schema.default;
        const enumValues = schema.enum;
        const enumType = schema.type as string;

        if (enumValues.length === 1) {
          result = z
            .literal(enumValues[0] as z.Primitive)
            .default(defaultValue);
        } else if (enumType === 'integer') {
          if (enumValues.length >= 2) {
            const [first, second, ...rest] = enumValues.map((val: unknown) =>
              z.literal(val as z.Primitive),
            );
            result = z.union([first, second, ...rest]).default(defaultValue);
          } else {
            result = z
              .literal(enumValues[0] as z.Primitive)
              .default(defaultValue);
          }
        } else {
          const stringValues = enumValues as string[];
          if (stringValues.length >= 2) {
            const [first, ...rest] = stringValues;
            result = z
              .enum([first, ...rest] as [string, ...string[]])
              .default(defaultValue);
          } else {
            result = z
              .literal(stringValues[0] as z.Primitive)
              .default(defaultValue);
          }
        }
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
          const subSchemas = types.map((t) => this.normal(t, schema, true));
          if (subSchemas.length >= 2) {
            const [first, second, ...rest] = subSchemas;
            result = z.union([first, second, ...rest]);
            if (!required) {
              result = result.optional();
            }
          } else {
            result = this.normal(types[0], schema, required, false);
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
): ZodSchema {
  const converter = new RuntimeZodConverter(spec);
  return converter.handle(schema, options?.required ?? false);
}
