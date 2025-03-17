import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { cleanRef, followRef, isRef, parseRef } from '../utils.ts';

type OnRefCallback = (ref: string, interfaceContent: string) => void;

/**
 * Convert an OpenAPI (JSON Schema style) object into TypeScript interfaces,
 */
export class TypeScriptDeserialzer {
  circularRefTracker = new Set<string>();
  #spec: OpenAPIObject;
  #onRef: OnRefCallback;

  constructor(spec: OpenAPIObject, onRef: OnRefCallback) {
    this.#spec = spec;
    this.#onRef = onRef;
  }
  #stringifyKey = (key: string): string => {
    // List of JavaScript keywords and special object properties that should be quoted
    const reservedWords = [
      'constructor',
      'prototype',
      'break',
      'case',
      'catch',
      'class',
      'const',
      'continue',
      'debugger',
      'default',
      'delete',
      'do',
      'else',
      'export',
      'extends',
      'false',
      'finally',
      'for',
      'function',
      'if',
      'import',
      'in',
      'instanceof',
      'new',
      'null',
      'return',
      'super',
      'switch',
      'this',
      'throw',
      'true',
      'try',
      'typeof',
      'var',
      'void',
      'while',
      'with',
      'yield',
    ];

    // Check if key is a reserved word
    if (reservedWords.includes(key)) {
      return `'${key}'`;
    }

    // Check if key is empty or only whitespace
    if (key.trim() === '') {
      return `'${key}'`;
    }

    // Check if first character is valid for identifiers
    const firstChar = key.charAt(0);
    const validFirstChar =
      (firstChar >= 'a' && firstChar <= 'z') ||
      (firstChar >= 'A' && firstChar <= 'Z') ||
      firstChar === '_' ||
      firstChar === '$';

    if (!validFirstChar) {
      return `'${key.replace(/'/g, "\\'")}'`;
    }

    // Check if the rest of the characters are valid for identifiers
    for (let i = 1; i < key.length; i++) {
      const char = key.charAt(i);
      const validChar =
        (char >= 'a' && char <= 'z') ||
        (char >= 'A' && char <= 'Z') ||
        (char >= '0' && char <= '9') ||
        char === '_' ||
        char === '$';

      if (!validChar) {
        return `'${key.replace(/'/g, "\\'")}'`;
      }
    }

    return key;
  };
  #stringifyKeyV2 = (value: string): string => {
    return `'${value}'`;
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
      return `${this.#stringifyKeyV2(key)}: ${tsType}`;
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

    return `{ ${propEntries.join('; ')} }`;
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
    return `${itemsType}[]`;
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
        // Unknown type -> fallback
        return appendOptional('any', required);
    }
  }

  ref($ref: string, required: boolean): string {
    const schemaName = cleanRef($ref).split('/').pop()!;

    if (this.circularRefTracker.has(schemaName)) {
      return schemaName;
    }

    this.circularRefTracker.add(schemaName);
    this.#onRef(schemaName, this.handle(followRef(this.#spec, $ref), true));
    this.circularRefTracker.delete(schemaName);

    return appendOptional(schemaName, required);
  }

  allOf(schemas: (SchemaObject | ReferenceObject)[]): string {
    // For TypeScript we use intersection types for allOf
    const allOfTypes = schemas.map((sub) => this.handle(sub, true));
    return allOfTypes.length > 1 ? `${allOfTypes.join(' & ')}` : allOfTypes[0];
  }

  anyOf(
    schemas: (SchemaObject | ReferenceObject)[],
    required: boolean,
  ): string {
    // For TypeScript we use union types for anyOf/oneOf
    const anyOfTypes = schemas.map((sub) => this.handle(sub, true));
    return appendOptional(
      anyOfTypes.length > 1 ? `${anyOfTypes.join(' | ')}` : anyOfTypes[0],
      required,
    );
  }

  oneOf(
    schemas: (SchemaObject | ReferenceObject)[],
    required: boolean,
  ): string {
    const oneOfTypes = schemas.map((sub) => {
      if (isRef(sub)) {
        const { model } = parseRef(sub.$ref);
        if (this.circularRefTracker.has(model)) {
          return model;
        }
      }
      return this.handle(sub, false);
    });
    return appendOptional(
      oneOfTypes.length > 1 ? `${oneOfTypes.join(' | ')}` : oneOfTypes[0],
      required,
    );
  }

  enum(values: any[], required: boolean): string {
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

  /**
   * Generate an interface declaration
   */
  generateInterface(
    name: string,
    schema: SchemaObject | ReferenceObject,
  ): string {
    const content = this.handle(schema, true);
    return `interface ${name} ${content}`;
  }
}

/**
 * Append "| undefined" if not required
 */
function appendOptional(type: string, isRequired?: boolean): string {
  return isRequired ? type : `${type} | undefined`;
}
