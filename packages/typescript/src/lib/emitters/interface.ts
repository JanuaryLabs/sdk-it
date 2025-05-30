import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { cleanRef, followRef, isRef, pascalcase } from '@sdk-it/core';
import { sanitizeTag } from '@sdk-it/spec';

type OnRefCallback = (ref: string, interfaceContent: string) => void;

/**
 * Convert an OpenAPI (JSON Schema style) object into TypeScript interfaces,
 */
export class TypeScriptEmitter {
  generatedRefs = new Set<string>();
  #spec: OpenAPIObject;
  #onRef: OnRefCallback;

  constructor(spec: OpenAPIObject, onRef: OnRefCallback) {
    this.#spec = spec;
    this.#onRef = onRef;
  }
  #stringifyKey = (value: string): string => {
    return `'${value}'`;
  };

  #isInternal = (schema: SchemaObject | ReferenceObject): boolean => {
    return isRef(schema) ? false : !!schema['x-internal'];
  };

  /**
   * Handle objects (properties)
   */
  object(schema: SchemaObject, required = false): string {
    const properties = schema.properties || {};

    // Convert each property
    const propEntries = Object.entries(properties).map(([key, propSchema]) => {
      const isRequired = (schema.required ?? []).includes(key);
      const tsType = this.handle(propSchema, isRequired);
      // Add question mark for optional properties
      return `${this.#isInternal(propSchema) ? key : this.#stringifyKey(key)}: ${tsType}`;
    });

    // Handle additionalProperties
    if (schema.additionalProperties) {
      if (typeof schema.additionalProperties === 'object') {
        const indexType = this.handle(schema.additionalProperties, true);
        propEntries.push(`[key: string]: ${indexType}`);
      } else if (schema.additionalProperties === true) {
        propEntries.push('[key: string]: any');
      }
    }

    return `${propEntries.length ? `{ ${propEntries.join('; ')} }` : 'unknown'}`;
  }

  /**
   * Handle arrays (items could be a single schema or a tuple)
   */
  array(schema: SchemaObject, required = false): string {
    const { items } = schema;
    if (!items) {
      // No items => any[]
      return 'any[]';
    }

    // If items is an array => tuple
    if (Array.isArray(items)) {
      const tupleItems = items.map((sub) => this.handle(sub, true));
      return `[${tupleItems.join(', ')}]`;
    }

    // If items is a single schema => standard array
    const itemsType = this.handle(items, true);
    return itemsType.length > 1 ? `(${itemsType})[]` : `${itemsType}[]`;
  }

  /**
   * Convert a basic type (string | number | boolean | object | array, etc.) to TypeScript
   */
  normal(type: string, schema: SchemaObject, required = false): string {
    switch (type) {
      case 'string':
        return this.string(schema, required);
      case 'number':
      case 'integer':
        return this.number(schema, required);
      case 'boolean':
        return appendOptional('boolean', required);
      case 'object':
        return this.object(schema, required);
      case 'array':
        return this.array(schema, required);
      case 'null':
        return 'null';
      default:
        console.warn(`Unknown type: ${type}`);
        // Unknown type -> fallback
        return appendOptional('any', required);
    }
  }

  ref($ref: string, required: boolean): string {
    const schemaName = sanitizeTag(cleanRef($ref).split('/').pop()!);

    if (this.generatedRefs.has(schemaName)) {
      return schemaName;
    }
    this.generatedRefs.add(schemaName);

    this.#onRef?.(
      pascalcase(schemaName),
      this.handle(followRef<SchemaObject>(this.#spec, $ref), required),
    );

    return appendOptional(pascalcase(schemaName), required);
  }

  allOf(schemas: (SchemaObject | ReferenceObject)[]): string {
    // For TypeScript we use intersection types for allOf
    const allOfTypes = schemas.map((sub) => this.handle(sub, true));
    return allOfTypes.length > 1 ? `${allOfTypes.join(' & ')}` : allOfTypes[0];
  }

  oneOf(
    schemas: (SchemaObject | ReferenceObject)[],
    required: boolean,
  ): string {
    // For TypeScript we use union types for anyOf/oneOf
    const oneOfTypes = schemas.map((sub) => this.handle(sub, true));
    return appendOptional(
      oneOfTypes.length > 1 ? `${oneOfTypes.join(' | ')}` : oneOfTypes[0],
      required,
    );
  }
  anyOf(
    schemas: (SchemaObject | ReferenceObject)[],
    required: boolean,
  ): string {
    return this.oneOf(schemas, required);
  }

  enum(values: unknown[], required: boolean): string {
    // For TypeScript enums as union of literals
    const enumValues = values
      .map((val) => (typeof val === 'string' ? `'${val}'` : `${val}`))
      .join(' | ');
    return appendOptional(enumValues, required);
  }

  /**
   * Handle string type with formats
   */
  string(schema: SchemaObject, required?: boolean): string {
    let type: string;

    if (schema.contentEncoding === 'binary') {
      return appendOptional('Blob', required);
    }

    switch (schema.format) {
      case 'date-time':
      case 'datetime':
      case 'date':
        type = 'Date';
        break;
      case 'binary':
      case 'byte':
        type = 'Blob';
        break;
      case 'int64':
        type = 'bigint';
        break;
      default:
        type = 'string';
    }

    return appendOptional(type, required);
  }

  /**
   * Handle number/integer types with formats
   */
  number(schema: SchemaObject, required?: boolean): string {
    const type = schema.format === 'int64' ? 'bigint' : 'number';
    return appendOptional(type, required);
  }

  handle(schema: SchemaObject | ReferenceObject, required: boolean): string {
    if (isRef(schema)) {
      return this.ref(schema.$ref, required);
    }

    // Handle allOf (intersection in TypeScript)
    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.allOf(schema.allOf);
    }

    // anyOf (union in TypeScript)
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.anyOf(schema.anyOf, required);
    }

    // oneOf (union in TypeScript)
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      return this.oneOf(schema.oneOf, required);
    }

    // enum
    if (schema.enum && Array.isArray(schema.enum)) {
      return this.enum(schema.enum, required);
    }

    if (schema.const) {
      if (schema['x-internal']) {
        return `${schema.const}`;
      }
      return this.enum([schema.const], required);
    }

    // Handle types, in TypeScript we can have union types directly
    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
        ? [schema.type]
        : [];

    // If no explicit "type", fallback to any
    if (!types.length) {
      // unless properties are defined then assume object
      if ('properties' in schema) {
        return this.object(schema, required);
      }
      return appendOptional('any', required);
    }

    // Handle union types (multiple types)
    if (types.length > 1) {
      const realTypes = types.filter((t) => t !== 'null');
      if (realTypes.length === 1 && types.includes('null')) {
        // Single real type + "null"
        const tsType = this.normal(realTypes[0], schema, false);
        return appendOptional(`${tsType} | null`, required);
      }

      // Multiple different types
      const typeResults = types.map((t) => this.normal(t, schema, false));
      return appendOptional(typeResults.join(' | '), required);
    }

    // Single type
    return this.normal(types[0], schema, required);
  }
}

/**
 * Append "| undefined" if not required
 */
function appendOptional(type: string, isRequired?: boolean): string {
  return isRequired ? type : `${type} | undefined`;
}
