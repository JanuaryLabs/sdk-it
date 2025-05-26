import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core';

/**
 * Generate example values for OpenAPI schemas
 * This emitter creates sample input payloads for API documentation and code snippets
 */
export class SnippetEmitter {
  private spec: OpenAPIObject;
  public generatedRefs = new Set<string>();
  private cache = new Map<string, unknown>();

  constructor(spec: OpenAPIObject) {
    this.spec = spec;
  }

  public object(
    schema: SchemaObject | ReferenceObject,
  ): Record<string, unknown> {
    const schemaObj = isRef(schema)
      ? followRef<SchemaObject>(this.spec, schema.$ref)
      : schema;
    const result: Record<string, unknown> = {};
    const properties = schemaObj.properties || {};

    for (const [propName, propSchema] of Object.entries(properties)) {
      const isRequired = (schemaObj.required ?? []).includes(propName);
      const resolvedProp = isRef(propSchema)
        ? followRef<SchemaObject>(this.spec, propSchema.$ref)
        : propSchema;

      if (
        isRequired ||
        resolvedProp.example !== undefined ||
        resolvedProp.default !== undefined ||
        Math.random() > 0.5
      ) {
        result[propName] = this.handle(propSchema);
      }
    }

    if (
      schemaObj.additionalProperties &&
      typeof schemaObj.additionalProperties === 'object'
    ) {
      result['additionalPropExample'] = this.handle(
        schemaObj.additionalProperties,
      );
    }

    return result;
  }

  public array(schema: SchemaObject | ReferenceObject): unknown[] {
    const schemaObj = isRef(schema)
      ? followRef<SchemaObject>(this.spec, schema.$ref)
      : schema;
    const itemsSchema = schemaObj.items;
    if (!itemsSchema) {
      return [];
    }

    const count = Math.min(schemaObj.minItems ?? 1, 2);
    const result: unknown[] = [];

    for (let i = 0; i < count; i++) {
      result.push(this.handle(itemsSchema));
    }

    return result;
  }

  public string(schema: SchemaObject): string {
    if (schema.example !== undefined) return String(schema.example);
    if (schema.default !== undefined) return String(schema.default);

    switch (schema.format) {
      case 'date-time':
      case 'datetime':
        return new Date().toISOString();
      case 'date':
        return new Date().toISOString().split('T')[0];
      case 'time':
        return new Date().toISOString().split('T')[1];
      case 'email':
        return 'user@example.com';
      case 'uuid':
        return '123e4567-e89b-12d3-a456-426614174000';
      case 'uri':
      case 'url':
        return 'https://example.com';
      case 'ipv4':
        return '192.168.1.1';
      case 'ipv6':
        return '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      case 'hostname':
        return 'example.com';
      case 'binary':
      case 'byte':
        return `new Blob(['example'], { type: 'text/plain' })`;
      default:
        if (schema.enum && schema.enum.length > 0) {
          return String(schema.enum[0]);
        }
        return schema.pattern ? `string matching ${schema.pattern}` : 'example';
    }
  }

  public number(schema: SchemaObject): number {
    if (schema.example !== undefined) return Number(schema.example);
    if (schema.default !== undefined) return Number(schema.default);

    let value: number;
    if (typeof schema.exclusiveMinimum === 'number') {
      value = schema.exclusiveMinimum + 1;
    } else if (typeof schema.minimum === 'number') {
      value = schema.minimum;
    } else {
      value = schema.type === 'integer' ? 42 : 42.42;
    }

    if (
      typeof schema.exclusiveMaximum === 'number' &&
      value >= schema.exclusiveMaximum
    ) {
      value = schema.exclusiveMaximum - 1;
    } else if (typeof schema.maximum === 'number' && value > schema.maximum) {
      value = schema.maximum;
    }

    if (
      typeof schema.multipleOf === 'number' &&
      value % schema.multipleOf !== 0
    ) {
      value = Math.floor(value / schema.multipleOf) * schema.multipleOf;
    }

    return schema.type === 'integer' ? Math.floor(value) : value;
  }

  public boolean(schema: SchemaObject): boolean {
    if (schema.example !== undefined) return Boolean(schema.example);
    if (schema.default !== undefined) return Boolean(schema.default);
    return true;
  }

  public null(): null {
    return null;
  }

  public ref($ref: string): unknown {
    const parts = $ref.split('/');
    const refKey = parts[parts.length - 1] || '';

    if (this.cache.has($ref)) {
      return this.cache.get($ref) as unknown;
    }

    this.cache.set($ref, { _ref: refKey });

    const resolved = followRef<SchemaObject>(this.spec, $ref);
    const result = this.handle(resolved);

    this.cache.set($ref, result);
    return result;
  }

  public allOf(schemas: (SchemaObject | ReferenceObject)[]): unknown {
    const initial: Record<string, unknown> = {};
    return schemas.reduce<Record<string, unknown>>((result, schema) => {
      const example = this.handle(schema);
      if (typeof example === 'object' && example !== null) {
        return { ...result, ...example };
      }
      return result;
    }, initial);
  }

  public anyOf(schemas: (SchemaObject | ReferenceObject)[]): unknown {
    if (schemas.length === 0) return {};
    return this.handle(schemas[0]);
  }

  public oneOf(schemas: (SchemaObject | ReferenceObject)[]): unknown {
    if (schemas.length === 0) return {};
    return this.handle(schemas[0]);
  }

  public enum(schema: SchemaObject): unknown {
    return Array.isArray(schema.enum) && schema.enum.length > 0
      ? schema.enum[0]
      : undefined;
  }

  public handle(schemaOrRef: SchemaObject | ReferenceObject): unknown {
    if (isRef(schemaOrRef)) {
      return this.ref(schemaOrRef.$ref);
    }

    const schema = isRef(schemaOrRef)
      ? followRef<SchemaObject>(this.spec, schemaOrRef.$ref)
      : schemaOrRef;

    if (schema.example !== undefined) {
      return schema.example;
    }
    if (schema.default !== undefined) {
      return schema.default;
    }

    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.allOf(schema.allOf);
    }
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.anyOf(schema.anyOf);
    }
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      return this.oneOf(schema.oneOf);
    }

    if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
      return this.enum(schema);
    }

    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
        ? [schema.type]
        : [];

    if (types.length === 0) {
      if (schema.properties || schema.additionalProperties) {
        return this.object(schema);
      } else if (schema.items) {
        return this.array(schema);
      }
      return 'example';
    }

    const primaryType = types.find((t) => t !== 'null') || types[0];

    switch (primaryType) {
      case 'string':
        return this.string(schema);
      case 'number':
      case 'integer':
        return this.number(schema);
      case 'boolean':
        return this.boolean(schema);
      case 'object':
        return this.object(schema);
      case 'array':
        return this.array(schema);
      case 'null':
        return this.null();
      default:
        return 'unknown';
    }
  }
}
