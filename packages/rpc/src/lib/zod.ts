import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import { type ZodType, z } from 'zod';

import { type OpenAPIDocument, followRef, isEmpty, isRef } from '@sdk-it/core';
import { zodStringFormat } from '@sdk-it/core/zod-string-format.js';
import {
  annotationsOf,
  discriminatorOf,
  isRecursiveRef,
  requiredOn,
  tupleOf,
} from '@sdk-it/spec';

type Discriminable = ZodType & z.core.$ZodTypeDiscriminable;

/**
 * Asserts that each branch exposes the `_zod.propValues` zod selects a
 * discriminated union branch by. `discriminatorOf` names a property only for
 * object branches, so a failure here is a bug in that rule.
 */
function assertDiscriminable(
  property: string,
  branches: ZodType[],
): asserts branches is [Discriminable, ...Discriminable[]] {
  if (
    branches.length === 0 ||
    !branches.every((branch) => 'propValues' in branch._zod)
  ) {
    throw new TypeError(
      `discriminatorOf named "${property}", but a branch of the union cannot be discriminated`,
    );
  }
}

/**
 * Convert an OpenAPI (JSON Schema style) object into a runtime Zod schema,
 */
export class RuntimeZodConverter {
  readonly #spec: OpenAPIDocument;

  constructor(spec: OpenAPIDocument) {
    this.#spec = spec;
  }

  #object(schema: SchemaObject): ZodType {
    const properties = schema.properties || {};
    const required = requiredOn(schema, this.#spec, 'request');

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
    const tuple = tupleOf(schema);
    if (tuple) {
      const [first, ...others] = tuple.elements;
      const elements: [ZodType, ...ZodType[]] = [
        this.handle(first.schema, first.required),
        ...others.map((element) =>
          this.handle(element.schema, element.required),
        ),
      ];
      return tuple.rest
        ? z.tuple(elements, this.handle(tuple.rest, true))
        : z.tuple(elements);
    }

    const { items } = schema;
    return z
      .array(items ? this.handle(items, true) : z.unknown())
      .check(...arrayLimits(schema));
  }

  /** One deferred schema per recursive component, shared by every reference to it. */
  #recursive = new Map<string, ZodType>();

  #ref($ref: string): ZodType {
    if (!isRecursiveRef(this.#spec, $ref)) {
      return this.handle(followRef(this.#spec, $ref), true);
    }
    return this.#recursive.getOrInsertComputed($ref, () => {
      let resolved: ZodType | undefined;
      return z.lazy(
        () => (resolved ??= this.handle(followRef(this.#spec, $ref), true)),
      );
    });
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

  anyOf(schema: SchemaObject): ZodType {
    return this.#union(schema, 'anyOf');
  }

  oneOf(schema: SchemaObject): ZodType {
    return this.#union(schema, 'oneOf');
  }

  /**
   * zod's union returns the first branch that succeeds, and JSON Schema's
   * unions have no order, so the null branch is checked before every other
   * branch, as `.nullable()` does: a coerce branch would turn null into 'null'.
   */
  #union(schema: SchemaObject, kind: 'anyOf' | 'oneOf'): ZodType {
    const all = schema[kind] ?? [];
    const branches = all
      .filter((sub) => !this.#isNull(sub))
      .map((sub) => this.handle(sub, true));
    if (branches.length === 0) {
      return z.null();
    }
    const union = this.#branches(schema, kind, branches);
    return branches.length < all.length ? union.nullable() : union;
  }

  #branches(
    schema: SchemaObject,
    kind: 'anyOf' | 'oneOf',
    branches: ZodType[],
  ): ZodType {
    if (branches.length === 1) {
      return branches[0];
    }
    const discriminated = this.#discriminatedUnion(schema, branches);
    if (discriminated) {
      return discriminated;
    }
    // oneOf is exclusive-or per JSON Schema; z.xor rejects values matching
    // more than one branch, unlike z.union's anyOf semantics.
    return kind === 'oneOf' ? z.xor(branches) : z.union(branches);
  }

  #isNull(schema: SchemaObject | ReferenceObject): boolean {
    return (
      (isRef(schema)
        ? followRef<SchemaObject>(this.#spec, schema.$ref)
        : schema
      ).type === 'null'
    );
  }

  /**
   * `branches` as a zod discriminated union, which reports an issue at the
   * discriminator, when the spec says that validates the same values.
   */
  #discriminatedUnion(
    schema: SchemaObject,
    branches: ZodType[],
  ): ZodType | undefined {
    const property = discriminatorOf(this.#spec, schema);
    if (property === undefined) {
      return undefined;
    }
    assertDiscriminable(property, branches);
    return z.discriminatedUnion(property, branches);
  }

  enum(type: SchemaObject['type'], values: unknown[]): ZodType {
    // An object or array member is compared by JSON value, not by identity.
    // Members are distinct values, so at most one branch matches.
    if (!values.every(isLiteral)) {
      return z.union(values.map(constSchema));
    }
    if (values.length === 1) {
      return z.literal(values[0]);
    }
    // z.enum only supports string values; zod 4 silently filters numeric
    // entries as reverse mappings, so any non-string enum must be a literal.
    if (values.every((value) => typeof value === 'string')) {
      return z.enum(values);
    }
    return z.literal(values);
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

    if (schema.format === 'byte' || schema.format === 'binary') {
      // Bare z.custom on purpose — see the contentEncoding branch above.
      return z.custom<Blob>();
    }
    const dateTime =
      schema.format === 'date-time' || schema.format === 'datetime';
    if (dateTime && schema['x-zod-type'] === 'coerce-date') {
      return z.coerce.date();
    }
    if (dateTime && schema['x-zod-type'] === 'date') {
      return z.date();
    }

    const base =
      schema['x-zod-type'] === 'coerce-string' ? z.coerce.string() : z.string();
    const format =
      schema.format === undefined
        ? undefined
        : zodStringFormat(schema.format, schema.pattern);
    if (!format) {
      return base.check(...stringLimits(schema));
    }
    const checked = format.schema.check(
      ...stringLimits({ ...schema, pattern: format.pattern }),
    );
    return schema['x-zod-type'] === 'coerce-string'
      ? base.pipe(checked)
      : checked;
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

    // zod's multipleOf is float-safe: Number.isInteger(0.7 / 0.001) is false.
    if (typeof schema.multipleOf === 'number') {
      base = base.multipleOf(schema.multipleOf);
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

    if (nullable) {
      base = base.nullable();
    }

    if (!required) {
      base = base.optional();
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
      return this.#annotate(result, schema);
    }

    let result: ZodType;

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
      result = this.anyOf(schema);
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
      result = this.oneOf(schema);
      if (!required) {
        result = result.optional();
      }
    } else if (schema.const !== undefined) {
      result = constSchema(schema.const);
      if (!required) {
        result = result.optional();
      }
    }

    // enum
    else if (schema.enum && Array.isArray(schema.enum)) {
      result = this.enum(schema.type, schema.enum);
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
          // A union of several types, its null checked first as in #union.
          result = z.union(realTypes.map((t) => this.normal(t, schema, true)));
          if (realTypes.length < types.length) {
            result = result.nullable();
          }
          if (!required) {
            result = result.optional();
          }
        }
      } else {
        result = this.normal(types[0], schema, required, false);
      }
    }

    return this.#annotate(result, schema);
  }

  /**
   * The schema's annotations as zod metadata, which agent tool schemas carry.
   * A client never inserts a `default`: it documents what the receiver does
   * when the value is absent.
   */
  #annotate(result: ZodType, schema: SchemaObject | ReferenceObject): ZodType {
    const annotations = annotationsOf(schema, this.#spec);
    const meta = {
      ...(annotations.title !== undefined && { title: annotations.title }),
      ...(annotations.description !== undefined && {
        description: annotations.description,
      }),
      ...(Object.hasOwn(annotations, 'default') && {
        default: annotations.default,
      }),
      ...(annotations.deprecated && { deprecated: true }),
      ...(annotations.readOnly && { readOnly: true }),
      ...(annotations.writeOnly && { writeOnly: true }),
      ...(annotations.examples.length > 0 && {
        examples: annotations.examples,
      }),
    };
    return Object.keys(meta).length === 0 ? result : result.meta(meta);
  }
}

/**
 * Convert a runtime SchemaObject to a Zod schema
 */
export function schemaToZod(
  schema: SchemaObject,
  spec: OpenAPIDocument,
  options?: {
    required?: boolean;
  },
): ZodType {
  const converter = new RuntimeZodConverter(spec);
  return converter.handle(schema, options?.required ?? false);
}

/** JSON Schema's array length keywords, as the checks that zod's own `z.fromJSONSchema` adds. */
function arrayLimits(schema: SchemaObject): z.core.$ZodCheck<unknown[]>[] {
  const limits: z.core.$ZodCheck<unknown[]>[] = [];
  if (typeof schema.minItems === 'number') {
    limits.push(z.minLength(schema.minItems));
  }
  if (typeof schema.maxItems === 'number') {
    limits.push(z.maxLength(schema.maxItems));
  }
  return limits;
}

/** JSON Schema's string length and pattern keywords, as the checks that zod's own `z.fromJSONSchema` adds. */
function stringLimits(schema: SchemaObject): z.core.$ZodCheck<string>[] {
  const limits: z.core.$ZodCheck<string>[] = [];
  if (typeof schema.minLength === 'number') {
    limits.push(z.minLength(schema.minLength));
  }
  if (typeof schema.maxLength === 'number') {
    limits.push(z.maxLength(schema.maxLength));
  }
  if (typeof schema.pattern === 'string') {
    // A JSON Schema pattern is an ECMA-262 regular expression that is not anchored.
    limits.push(z.regex(new RegExp(schema.pattern)));
  }
  return limits;
}

function isLiteral(value: unknown): value is z.core.util.Literal {
  return value === null || typeof value !== 'object';
}

/**
 * A schema that accepts exactly one JSON value, as JSON Schema compares a
 * `const`: by value, element by element and key by key, with no other keys.
 */
function constSchema(value: unknown): ZodType {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return z.literal(value);
  }
  if (Array.isArray(value)) {
    const [first, ...rest] = value.map(constSchema);
    return first === undefined ? z.tuple([]) : z.tuple([first, ...rest]);
  }
  if (value !== null && typeof value === 'object') {
    return z.strictObject(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, constSchema(item)]),
      ),
    );
  }
  return z.null();
}
