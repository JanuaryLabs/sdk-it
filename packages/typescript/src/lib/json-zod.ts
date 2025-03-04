import { get } from 'lodash';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

/**
 * Recursively resolve a $ref in the OpenAPI spec.
 */

function cleanRef(ref: string) {
  return ref.replace(/^#\//, '');
}
export function followRef(
  spec: OpenAPIObject,
  ref: string,
): SchemaObject | ReferenceObject {
  // Adjust get(...) usage for your data structure
  const pathParts = cleanRef(ref).split('/');
  const entry = get(spec, pathParts) as SchemaObject | ReferenceObject;
  if (entry && '$ref' in entry) {
    return followRef(spec, entry.$ref);
  }
  return entry;
}

type OnRefCallback = (ref: string, zod: string) => void;

/**
 * Convert an OpenAPI (JSON Schema style) object into a Zod schema string,
 * adapted for OpenAPI 3.1 (fully aligned with JSON Schema 2020-12).
 */

export function jsonSchemaToZod(
  spec: OpenAPIObject,
  schema: SchemaObject | ReferenceObject,
  required = false,
  onRef: OnRefCallback,
  refProcessingStack = new Set<string>(), // Add as optional parameter with default value
): string {
  // If it's a reference, resolve and recurse
  if ('$ref' in schema) {
    const schemaName = cleanRef(schema.$ref).split('/').pop()!;

    // Check for circular references
    if (refProcessingStack.has(schemaName)) {
      return schemaName;
    }

    refProcessingStack.add(schemaName);
    onRef(
      schemaName,
      jsonSchemaToZod(
        spec,
        followRef(spec, schema.$ref),
        required,
        onRef,
        refProcessingStack,
      ),
    );
    refProcessingStack.delete(schemaName);

    return schemaName;
  }

  // Handle allOf → intersection
  if (schema.allOf && Array.isArray(schema.allOf)) {
    const allOfSchemas = schema.allOf.map((sub) =>
      jsonSchemaToZod(spec, sub, true, onRef, refProcessingStack),
    );
    return `z.intersection(${allOfSchemas.join(', ')})`;
  }

  // anyOf → union
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const anyOfSchemas = schema.anyOf.map((sub) =>
      jsonSchemaToZod(spec, sub, false, onRef, refProcessingStack),
    );
    return `z.union([${anyOfSchemas.join(', ')}])${appendOptional(required)}`;
  }

  // oneOf → union
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const oneOfSchemas = schema.oneOf.map((sub) => {
      if ('$ref' in sub) {
        const refName = cleanRef(sub.$ref).split('/').pop()!;
        if (refProcessingStack.has(refName)) {
          return refName;
        }
      }
      return jsonSchemaToZod(spec, sub, false, onRef, refProcessingStack);
    });
    return `z.union([${oneOfSchemas.join(', ')}])${appendOptional(required)}`;
  }

  // enum
  if (schema.enum && Array.isArray(schema.enum)) {
    const enumVals = schema.enum.map((val) => JSON.stringify(val)).join(', ');
    return `z.enum([${enumVals}])${appendOptional(required)}`;
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
  if (types.length > 1) {
    // If it’s exactly one real type plus "null", we can do e.g. `z.string().nullable()`
    const realTypes = types.filter((t) => t !== 'null');
    if (realTypes.length === 1 && types.includes('null')) {
      // Single real type + "null"
      const typeZod = basicTypeToZod(
        realTypes[0],
        schema,
        spec,
        false,
        onRef,
        refProcessingStack,
      );
      return `${typeZod}.nullable()${appendOptional(required)}`;
    }
    // If multiple different types, build a union
    const subSchemas = types.map((t) =>
      basicTypeToZod(t, schema, spec, false, onRef, refProcessingStack),
    );
    return `z.union([${subSchemas.join(', ')}])${appendOptional(required)}`;
  }

  // If there's exactly one type
  return basicTypeToZod(
    types[0],
    schema,
    spec,
    required,
    onRef,
    refProcessingStack,
  );
}

/**
 * Convert a basic type (string | number | boolean | object | array, etc.) to Zod.
 * We'll also handle .optional() if needed.
 */
function basicTypeToZod(
  type: string,
  schema: SchemaObject,
  spec: OpenAPIObject,
  required = false,
  onRef: OnRefCallback,
  refProcessingStack: Set<string>,
): string {
  switch (type) {
    case 'string':
      return handleString(schema, required);
    case 'number':
    case 'integer':
      return handleNumber(schema, required);
    case 'boolean':
      return `z.boolean()${appendDefault(schema.default)}${appendOptional(required)}`;
    case 'object':
      return handleObject(schema, spec, required, onRef, refProcessingStack);
    case 'array':
      return handleArray(schema, spec, required, onRef, refProcessingStack);
    case 'null':
      // If "type": "null" alone, this is basically z.null()
      return `z.null()${appendOptional(required)}`;
    default:
      // Unknown type -> fallback
      return `z.unknown()${appendOptional(required)}`;
  }
}

/**
 * Handle a `string` schema with possible format keywords (JSON Schema).
 */
function handleString(schema: SchemaObject, required?: boolean): string {
  let base = 'z.string()';

  // 3.1 replaces `example` in the schema with `examples` (array).
  // We do not strictly need them for the Zod type, so they’re optional
  // for validation. However, we could keep them as metadata if you want.

  switch (schema.format) {
    case 'date-time':
    case 'datetime':
      // parse to JS Date
      base = 'z.coerce.date()';
      break;
    case 'date':
      base = 'z.coerce.date() /* or z.string() if you want raw date strings */';
      break;
    case 'time':
      base = 'z.string() /* optionally add .regex(...) for HH:MM:SS format */';
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
      base = 'z.instanceof(Blob) /* consider base64 check if needed */';
      break;
    case 'int64':
      // JS numbers can't reliably store int64, consider z.bigint() or keep as string
      base = 'z.string() /* or z.bigint() if your app can handle it */';
      break;
    default:
      // No special format
      break;
  }

  return `${base}${appendDefault(schema.default)}${appendOptional(required)}`;
}

/**
 * Handle number/integer constraints from OpenAPI/JSON Schema.
 * In 3.1, exclusiveMinimum/Maximum hold the actual numeric threshold,
 * rather than a boolean toggling `minimum`/`maximum`.
 */
function handleNumber(schema: SchemaObject, required?: boolean): string {
  let defaultValue =
    schema.default !== undefined ? `.default(${schema.default})` : ``;
  let base = 'z.number()';
  if (schema.format === 'int64') {
    base = 'z.bigint()';
    if (schema.default !== undefined) {
      defaultValue = `.default(BigInt(${schema.default}))`;
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

  return `${base}${defaultValue}${appendOptional(required)}`;
}

/**
 * Handle objects (properties, additionalProperties).
 */
function handleObject(
  schema: SchemaObject,
  spec: OpenAPIObject,
  required = false,
  onRef: OnRefCallback,
  refProcessingStack: Set<string>,
): string {
  const properties = schema.properties || {};

  // Convert each property
  const propEntries = Object.entries(properties).map(([key, propSchema]) => {
    const isRequired = (schema.required ?? []).includes(key);
    const zodPart = jsonSchemaToZod(
      spec,
      propSchema,
      isRequired,
      onRef,
      refProcessingStack,
    );
    return `'${key}': ${zodPart}`;
  });

  // additionalProperties
  let additionalProps = '';
  if (schema.additionalProperties) {
    if (typeof schema.additionalProperties === 'object') {
      // e.g. z.record() if it’s an object schema
      const addPropZod = jsonSchemaToZod(
        spec,
        schema.additionalProperties,
        true,
        onRef,
        refProcessingStack,
      );
      additionalProps = `.catchall(${addPropZod})`;
    } else if (schema.additionalProperties === true) {
      // free-form additional props
      additionalProps = `.catchall(z.unknown())`;
    }
  }

  const objectSchema = `z.object({${propEntries.join(', ')}})${additionalProps}`;
  return `${objectSchema}${appendOptional(required)}`;
}

/**
 * Handle arrays (items could be a single schema or a tuple (array of schemas)).
 * In JSON Schema 2020-12, `items` can be an array → tuple style.
 */
function handleArray(
  schema: SchemaObject,
  spec: OpenAPIObject,
  required = false,
  onRef: OnRefCallback,
  refProcessingStack: Set<string>,
): string {
  const { items } = schema;
  if (!items) {
    // No items => z.array(z.unknown())
    return `z.array(z.unknown())${appendOptional(required)}`;
  }

  // If items is an array => tuple
  if (Array.isArray(items)) {
    // Build a Zod tuple
    const tupleItems = items.map((sub) =>
      jsonSchemaToZod(spec, sub, true, onRef, refProcessingStack),
    );
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
  const itemsSchema = jsonSchemaToZod(
    spec,
    items,
    true,
    onRef,
    refProcessingStack,
  );
  return `z.array(${itemsSchema})${appendOptional(required)}`;
}

/**
 * Append .optional() if not required
 */
function appendOptional(isRequired?: boolean) {
  return isRequired ? '' : '.optional()';
}
function appendDefault(defaultValue?: any) {
  return defaultValue !== undefined
    ? `.default(${JSON.stringify(defaultValue)})`
    : '';
}

// Todo: convert openapi 3.0 to 3.1 before proccesing
