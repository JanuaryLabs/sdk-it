import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { cleanRef, followRef, isRef } from '@sdk-it/core';

type OnRefCallback = (ref: string, content: string) => void;

/**
 * Convert an OpenAPI (JSON Schema style) object into a Zod schema string,
 * adapted for OpenAPI 3.1 (fully aligned with JSON Schema 2020-12).
 */
export class ZodDeserialzer {
  generatedRefs = new Set<string>();
  #spec: OpenAPIObject;
  #onRef?: OnRefCallback;

  constructor(spec: OpenAPIObject, onRef?: OnRefCallback) {
    this.#spec = spec;
    this.#onRef = onRef;
  }
  /**
   * Handle objects (properties, additionalProperties).
   */
  object(schema: SchemaObject): string {
    const properties = schema.properties || {};

    // Convert each property
    const propEntries = Object.entries(properties).map(([key, propSchema]) => {
      const isRequired = (schema.required ?? []).includes(key);
      return `'${key}': ${this.handle(propSchema, isRequired)}`;
    });

    let additionalProps = '';
    if (schema.additionalProperties) {
      if (typeof schema.additionalProperties === 'object') {
        // e.g. z.record() if it’s an object schema
        const addPropZod = this.handle(schema.additionalProperties, true);
        additionalProps = `.catchall(${addPropZod})`;
      } else if (schema.additionalProperties === true) {
        // free-form additional props
        additionalProps = `.catchall(z.unknown())`;
      }
    }

    return `z.object({${propEntries.join(', ')}})${additionalProps}`;
  }

  /**
   * Handle arrays (items could be a single schema or a tuple (array of schemas)).
   * In JSON Schema 2020-12, `items` can be an array → tuple style.
   */
  array(schema: SchemaObject, required = false): string {
    const { items } = schema;
    if (!items) {
      // No items => z.array(z.unknown())
      return `z.array(z.unknown())${appendOptional(required)}`;
    }

    // If items is an array => tuple
    if (Array.isArray(items)) {
      // Build a Zod tuple
      const tupleItems = items.map((sub) => this.handle(sub, true));
      const base = `z.tuple([${tupleItems.join(', ')}])`;
      // // If we have additionalItems: false => that’s a fixed length
      // // If additionalItems is a schema => rest(...)
      // if (schema.additionalItems) {
      //   if (typeof schema.additionalItems === 'object') {
      //     const restSchema = jsonSchemaToZod(spec, schema.additionalItems, true);
      //     base += `.rest(${restSchema})`;
      //   }
      //   // If `additionalItems: false`, no rest is allowed => do nothing
      // }
      return `${base}${appendOptional(required)}`;
    }

    // If items is a single schema => standard z.array(...)
    const itemsSchema = this.handle(items, true);
    return `z.array(${itemsSchema})${appendOptional(required)}`;
  }

  #suffixes = (defaultValue: unknown, required: boolean, nullable: boolean) => {
    return `${nullable ? '.nullable()' : ''}${appendDefault(defaultValue)}${appendOptional(required)}`;
  };

  /**
   * Convert a basic type (string | number | boolean | object | array, etc.) to Zod.
   * We'll also handle .optional() if needed.
   */
  normal(
    type: string,
    schema: SchemaObject,
    required = false,
    nullable = false,
  ): string {
    switch (type) {
      case 'string':
        return `${this.string(schema)}${this.#suffixes(JSON.stringify(schema.default), required, nullable)}`;
      case 'number':
      case 'integer': {
        const { base, defaultValue } = this.number(schema);
        return `${base}${this.#suffixes(defaultValue, required, nullable)}`;
      }
      case 'boolean':
        return `z.boolean()${this.#suffixes(schema.default, required, nullable)}`;
      case 'object':
        return `${this.object(schema)}${this.#suffixes(JSON.stringify(schema.default), required, nullable)}`;
      // required always
      case 'array':
        return this.array(schema, required);
      case 'null':
        // If "type": "null" alone, this is basically z.null()
        return `z.null()${appendOptional(required)}`;
      default:
        // Unknown type -> fallback
        return `z.unknown()${appendOptional(required)}`;
    }
  }

  ref($ref: string, required: boolean) {
    const schemaName = cleanRef($ref).split('/').pop()!;

    if (this.generatedRefs.has(schemaName)) {
      return schemaName;
    }
    this.generatedRefs.add(schemaName);
    this.#onRef?.(
      schemaName,
      this.handle(followRef<SchemaObject>(this.#spec, $ref), required),
    );

    return schemaName;
  }
  allOf(schemas: (SchemaObject | ReferenceObject)[], required: boolean) {
    const allOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (allOfSchemas.length === 0) {
      return `z.unknown()`;
    }
    if (allOfSchemas.length === 1) {
      return `${allOfSchemas[0]}${appendOptional(required)}`;
    }
    return `${this.#toIntersection(allOfSchemas)}${appendOptional(required)}`;
  }

  #toIntersection(schemas: string[]): string {
    const [left, ...right] = schemas;
    if (!right.length) {
      return left;
    }
    return `z.intersection(${left}, ${this.#toIntersection(right)})`;
  }

  anyOf(schemas: (SchemaObject | ReferenceObject)[], required: boolean) {
    const anyOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (anyOfSchemas.length === 1) {
      return `${anyOfSchemas[0]}${appendOptional(required)}`;
    }
    return `z.union([${anyOfSchemas.join(', ')}])${appendOptional(required)}`;
  }

  oneOf(schemas: (SchemaObject | ReferenceObject)[], required: boolean) {
    const oneOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (oneOfSchemas.length === 1) {
      return `${oneOfSchemas[0]}${appendOptional(required)}`;
    }
    return `z.union([${oneOfSchemas.join(', ')}])${appendOptional(required)}`;
  }

  enum(type: string, values: any[]) {
    if (values.length === 1) {
      return `z.literal(${values.join(', ')})`;
    }
    if (type === 'integer') {
      // Zod doesn’t have a direct enum for numbers, so we use union of literals
      return `z.union([${values.map((val) => `z.literal(${val})`).join(', ')}])`;
    }

    return `z.enum([${values.join(', ')}])`;
  }

  /**
   * Handle a `string` schema with possible format keywords (JSON Schema).
   */
  string(schema: SchemaObject): string {
    let base = 'z.string()';

    // 3.1 replaces `example` in the schema with `examples` (array).
    // We do not strictly need them for the Zod type, so they’re optional
    // for validation. However, we could keep them as metadata if you want.

    if (schema.contentEncoding === 'binary') {
      base = 'z.instanceof(Blob)';
      return base;
    }

    switch (schema.format) {
      case 'date-time':
      case 'datetime':
        // parse to JS Date
        base = 'z.coerce.date()';
        break;
      case 'date':
        base =
          'z.coerce.date() /* or z.string() if you want raw date strings */';
        break;
      case 'time':
        base =
          'z.string() /* optionally add .regex(...) for HH:MM:SS format */';
        break;
      case 'email':
        base = 'z.string().email()';
        break;
      case 'uuid':
        base = 'z.string().uuid()';
        break;
      case 'url':
      case 'uri':
        base = 'z.string().url()';
        break;
      case 'ipv4':
        base = 'z.string().ip({version: "v4"})';
        break;
      case 'ipv6':
        base = 'z.string().ip({version: "v6"})';
        break;
      case 'phone':
        base = 'z.string() /* or add .regex(...) for phone formats */';
        break;
      case 'byte':
      case 'binary':
        base = 'z.instanceof(Blob)';
        break;
      case 'int64':
        // JS numbers can't reliably store int64, consider z.bigint() or keep as string
        base = 'z.string() /* or z.bigint() if your app can handle it */';
        break;
      default:
        // No special format
        break;
    }

    return base;
  }

  /**
   * Handle number/integer constraints from OpenAPI/JSON Schema.
   * In 3.1, exclusiveMinimum/Maximum hold the actual numeric threshold,
   * rather than a boolean toggling `minimum`/`maximum`.
   */
  number(schema: SchemaObject) {
    let defaultValue = schema.default;
    let base = 'z.number()';
    if (schema.format === 'int64') {
      base = 'z.bigint()';
      if (schema.default !== undefined) {
        defaultValue = `BigInt(${schema.default})`;
      }
    }

    if (schema.format === 'int32') {
      // 32-bit integer
      base += '.int()';
    }

    // If we see exclusiveMinimum as a number in 3.1:
    if (typeof schema.exclusiveMinimum === 'number') {
      // Zod doesn’t have a direct "exclusiveMinimum" method, so we can do .gt()
      // If exclusiveMinimum=7 => .gt(7)
      base += `.gt(${schema.exclusiveMinimum})`;
    }
    // Similarly for exclusiveMaximum
    if (typeof schema.exclusiveMaximum === 'number') {
      // If exclusiveMaximum=10 => .lt(10)
      base += `.lt(${schema.exclusiveMaximum})`;
    }

    // If standard minimum/maximum
    if (typeof schema.minimum === 'number') {
      base +=
        schema.format === 'int64'
          ? `.min(BigInt(${schema.minimum}))`
          : `.min(${schema.minimum})`;
    }
    if (typeof schema.maximum === 'number') {
      base +=
        schema.format === 'int64'
          ? `.max(BigInt(${schema.maximum}))`
          : `.max(${schema.maximum})`;
    }

    // multipleOf
    if (typeof schema.multipleOf === 'number') {
      // There's no direct multipleOf in Zod. Some folks do a custom refine.
      // For example:
      base += `.refine((val) => Number.isInteger(val / ${schema.multipleOf}), "Must be a multiple of ${schema.multipleOf}")`;
    }

    return { base, defaultValue };
  }

  handle(schema: SchemaObject | ReferenceObject, required: boolean): string {
    if (isRef(schema)) {
      return `${this.ref(schema.$ref, true)}${appendOptional(required)}`;
    }

    // Handle allOf → intersection
    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.allOf(schema.allOf ?? [], required);
    }

    // anyOf → union
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.anyOf(schema.anyOf ?? [], required);
    }

    // oneOf → union
    if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length) {
      return this.oneOf(schema.oneOf ?? [], required);
    }

    // enum
    if (schema.enum && Array.isArray(schema.enum)) {
      const enumVals = schema.enum.map((val) => JSON.stringify(val));
      const defaultValue = enumVals.includes(JSON.stringify(schema.default))
        ? JSON.stringify(schema.default)
        : undefined;
      return `${this.enum(schema.type as string, enumVals)}${this.#suffixes(defaultValue, required, false)}`;
    }

    // 3.1 can have type: string or type: string[] (e.g. ["string","null"])
    // Let's parse that carefully.
    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
        ? [schema.type]
        : [];

    // If no explicit "type", fallback to unknown
    if (!types.length) {
      return `z.unknown()${appendOptional(required)}`;
    }

    // If it's a union type (like ["string", "null"]), we'll build a Zod union
    // or apply .nullable() if it's just "type + null".

    // backward compatibility with openapi 3.0
    if ('nullable' in schema && schema.nullable) {
      types.push('null');
    } else if (schema.default === null) {
      types.push('null');
    }

    if (types.length > 1) {
      // If it’s exactly one real type plus "null", we can do e.g. `z.string().nullable()`
      const realTypes = types.filter((t) => t !== 'null');
      if (realTypes.length === 1 && types.includes('null')) {
        // Single real type + "null"
        return this.normal(realTypes[0], schema, required, true);
      }
      // If multiple different types, build a union
      const subSchemas = types.map((t) => this.normal(t, schema, false));
      return `z.union([${subSchemas.join(', ')}])${appendOptional(required)}`;
    }
    return this.normal(types[0], schema, required, false);
  }
}

/**
 * Append .optional() if not required
 */
function appendOptional(isRequired?: boolean) {
  return isRequired ? '' : '.optional()';
}
function appendDefault(defaultValue?: any) {
  return defaultValue !== undefined || typeof defaultValue !== 'undefined'
    ? `.default(${defaultValue})`
    : '';
}

// Todo: convert openapi 3.0 to 3.1 before proccesing
