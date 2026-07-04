import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef, parseRef, pascalcase } from '@sdk-it/core';
import { isPrimitiveSchema, sanitizeTag } from '@sdk-it/spec';

type OnRefCallback = (ref: string, content: string) => void;

/**
 * Convert an OpenAPI (JSON Schema style) object into a Zod schema string,
 */
export class ZodEmitter {
  #generatedRefs = new Set<string>();
  #spec: OpenAPIObject;
  #onRef?: OnRefCallback;

  constructor(spec: OpenAPIObject, onRef?: OnRefCallback) {
    this.#spec = spec;
    this.#onRef = onRef;
  }

  #object(schema: SchemaObject): string {
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

  #array(schema: SchemaObject, required = false): string {
    const { items } = schema;
    if (!items) {
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
    return `z.array(${itemsSchema})${this.#suffixes(JSON.stringify(schema.default), required, false)}`;
  }

  #suffixes = (defaultValue: unknown, required: boolean, nullable: boolean) => {
    return `${nullable ? '.nullable()' : ''}${appendOptional(required)}${appendDefault(defaultValue)}`;
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
      case 'string': {
        const defaultVal =
          (schema['x-zod-type'] === 'date' ||
            schema['x-zod-type'] === 'coerce-date') &&
          schema.default
            ? `new Date(${JSON.stringify(schema.default)})`
            : JSON.stringify(schema.default);
        return `${this.string(schema)}${this.#suffixes(defaultVal, required, nullable)}`;
      }
      case 'number':
      case 'integer': {
        const { base, defaultValue } = this.#number(schema);
        return `${base}${this.#suffixes(defaultValue, required, nullable)}`;
      }
      case 'boolean':
        return `${schema['x-zod-type'] === 'coerce-boolean' ? 'z.union([z.boolean(), z.stringbool()])' : 'z.boolean()'}${this.#suffixes(schema.default, required, nullable)}`;
      case 'object':
        return `${this.#object(schema)}${this.#suffixes(JSON.stringify(schema.default), required, nullable)}`;
      // required always
      case 'array':
        return this.#array(schema, required);
      case 'null':
        // If "type": "null" alone, this is basically z.null()
        return `z.null()${appendOptional(required)}`;
      default:
        // Unknown type -> fallback
        return `z.unknown()${appendOptional(required)}`;
    }
  }

  #ref($ref: string, required: boolean) {
    const schemaName = pascalcase(sanitizeTag(parseRef($ref).model));
    const schema = followRef(this.#spec, $ref);

    if (isPrimitiveSchema(schema)) {
      const result = this.handle(schema, required);
      this.#onRef?.(schemaName, result);
      return result;
    }

    if (this.#generatedRefs.has(schemaName)) {
      return schemaName;
    }
    this.#generatedRefs.add(schemaName);
    this.#onRef?.(schemaName, this.handle(schema, required));

    return schemaName;
  }
  #toIntersection(schemas: string[]): string {
    const [left, ...right] = schemas;
    if (!right.length) {
      return left;
    }
    return `z.intersection(${left}, ${this.#toIntersection(right)})`;
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
    // oneOf is exclusive-or per JSON Schema; z.xor rejects values matching
    // more than one branch, unlike z.union's anyOf semantics.
    return `z.xor([${oneOfSchemas.join(', ')}])${appendOptional(required)}`;
  }

  enum(type: string, values: any[]) {
    if (values.length === 1) {
      return `z.literal(${values.join(', ')})`;
    }
    // Values arrive JSON.stringify'd, so string literals start with a quote.
    // z.enum only takes strings; zod 4 silently filters numeric entries as
    // reverse mappings, so any non-string enum must emit z.literal([...]).
    if (values.every((value) => String(value).startsWith('"'))) {
      return `z.enum([${values.join(', ')}])`;
    }
    return `z.literal([${values.join(', ')}])`;
  }

  /**
   * Handle a `string` schema with possible format keywords (JSON Schema).
   */
  string(schema: SchemaObject): string {
    let base =
      schema['x-zod-type'] === 'coerce-string'
        ? 'z.coerce.string()'
        : 'z.string()';

    // 3.1 replaces `example` in the schema with `examples` (array).
    // We do not strictly need them for the Zod type, so they’re optional
    // for validation. However, we could keep them as metadata if you want.

    if (schema.contentEncoding === 'binary') {
      // Emitted client code must not reference Blob as a runtime value:
      // it throws ReferenceError where the global is missing and fails
      // instanceof for cross-realm/polyfill Blobs (see e62c4e1 and
      // docs/recipes/file-upload.md).
      base = 'z.custom<Blob>()';
      return base;
    }

    const coerced = schema['x-zod-type'] === 'coerce-string';
    const withFormat = (format: string) =>
      coerced ? `${base}.pipe(${format})` : format;

    switch (schema.format) {
      case 'date-time':
      case 'datetime':
        if (schema['x-zod-type'] === 'coerce-date') {
          base = 'z.coerce.date()';
        } else if (schema['x-zod-type'] === 'date') {
          base = 'z.date()';
        } else {
          // RFC 3339 date-time allows numeric zone offsets, which
          // z.iso.datetime() rejects by default.
          base = withFormat('z.iso.datetime({ offset: true })');
        }
        break;
      case 'date':
        base = withFormat('z.iso.date()');
        break;
      case 'time':
        // z.iso.time() rejects RFC 3339 zone suffixes, which JSON Schema's
        // format: time allows.
        base = withFormat(
          'z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)?$/)',
        );
        break;
      case 'email':
        base = withFormat('z.email()');
        break;
      case 'uuid':
        // z.guid() preserves zod v3's looser .uuid() semantics; z.uuid()
        // enforces RFC 9562 variant bits and rejects Microsoft-style GUIDs.
        base = withFormat('z.guid()');
        break;
      case 'url':
      case 'uri':
        base = withFormat('z.url()');
        break;
      case 'ipv4':
        base = withFormat('z.ipv4()');
        break;
      case 'ipv6':
        base = withFormat('z.ipv6()');
        break;
      case 'cidrv4':
        base = withFormat('z.cidrv4()');
        break;
      case 'cidrv6':
        base = withFormat('z.cidrv6()');
        break;
      case 'phone':
        base += ' /* or add .regex(...) for phone formats */';
        break;
      case 'byte':
      case 'binary':
        // Bare z.custom on purpose — see the contentEncoding branch above.
        base = 'z.custom<Blob>()';
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
  #number(schema: SchemaObject) {
    let base =
      schema['x-zod-type'] === 'coerce-number'
        ? 'z.coerce.number()'
        : 'z.number()';

    if (schema.type === 'integer') {
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
      base += `.min(${schema.minimum})`;
    }
    if (typeof schema.maximum === 'number') {
      base += `.max(${schema.maximum})`;
    }

    // multipleOf
    if (typeof schema.multipleOf === 'number') {
      // There's no direct multipleOf in Zod. Some folks do a custom refine.
      // For example:
      base += `.refine((val) => Number.isInteger(val / ${schema.multipleOf}), "Must be a multiple of ${schema.multipleOf}")`;
    }

    return { base, defaultValue: schema.default };
  }

  handle(schema: SchemaObject | ReferenceObject, required: boolean): string {
    if (isRef(schema)) {
      return `${this.#ref(schema.$ref, true)}${appendOptional(required)}`;
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

function appendOptional(isRequired?: boolean) {
  return isRequired ? '' : '.optional()';
}


function appendDefault(defaultValue?: any) {
  return defaultValue !== undefined || typeof defaultValue !== 'undefined'
    ? `.default(${defaultValue})`
    : '';
}

export function toZod(schema: SchemaObject, required?: boolean): string {
  const emitter = new ZodEmitter({} as OpenAPIObject);
  const schemaStr = emitter.handle(schema, required ?? false);
  if (schema['x-prefix']) {
    const prefix = schema['x-prefix'];
    if (required === false) {
      return (
        schemaStr +
        `.transform((val) => (val ? \`${prefix}\${val}\` : undefined))`
      );
    } else {
      return schemaStr + `.transform((val) => \`${prefix}\${val}\`)`;
    }
  }
  return schemaStr;
}
