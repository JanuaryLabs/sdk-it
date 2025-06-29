import type {
  OpenAPIObject,
  ReferenceObject,
  RequestBodyObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core';
import { coerceTypes } from '@sdk-it/spec';

/**
 * PropEmitter handles converting OpenAPI schemas to Markdown documentation
 * Similar structure to ZodDeserializer but for generating markdown props documentation
 */
export class PropEmitter {
  #spec: OpenAPIObject;

  constructor(spec: OpenAPIObject) {
    this.#spec = spec;
  }

  /**
   * Handle objects (properties)
   */
  #object(schema: SchemaObject): string[] {
    const lines: string[] = [];
    const properties = schema.properties || {};

    if (Object.keys(properties).length > 0) {
      lines.push(`**Properties:**`);

      for (const [propName, propSchema] of Object.entries(properties)) {
        const isRequired = (schema.required ?? []).includes(propName);
        lines.push(...this.#property(propName, propSchema, isRequired));
      }
    }

    // Handle additionalProperties
    if (schema.additionalProperties) {
      lines.push(`**Additional Properties:**`);
      if (typeof schema.additionalProperties === 'boolean') {
        lines.push(`- Allowed: ${schema.additionalProperties}`);
      } else {
        // Indent the schema documentation for additional properties
        lines.push(
          ...this.handle(schema.additionalProperties).map((l) => `  ${l}`),
        );
      }
    }

    return lines;
  }

  /**
   * Format a property with its type and description
   */
  #property(
    name: string,
    schema: SchemaObject | ReferenceObject,
    required: boolean,
  ): string[] {
    // get full docs and extract the type line
    const docs = this.handle(schema);
    const rawType = docs[0]
      .replace('**Type:** ', '')
      .replace(' (nullable)', '|null');

    // detect default if present on the schema
    const defaultVal =
      !isRef(schema) && (schema as SchemaObject).default !== undefined
        ? ` default: ${JSON.stringify((schema as SchemaObject).default)}`
        : '';

    // build summary line
    const reqMark = required ? ' required' : '';
    const summary = `- \`${name}\` ${rawType}${reqMark}${defaultVal}:`;

    // assemble final lines (skip the type and any default in details)
    const detailLines = docs
      .slice(1)
      .filter((l) => !l.startsWith('**Default:**'))
      .map((l) => `  ${l}`);

    return [summary, ...detailLines];
  }

  /**
   * Handle array schemas
   */
  #array(schema: SchemaObject): string[] {
    const lines: string[] = [];
    lines.push(`**Array items:**`);

    if (schema.items) {
      // Get documentation for the items schema
      const itemDocs = this.handle(schema.items);
      // Indent item documentation
      lines.push(...itemDocs.map((line) => `  ${line}`));
    } else {
      lines.push(`  **Type:** \`unknown\``); // Array of unknown items
    }
    // Add array constraints
    if (schema.minItems !== undefined)
      lines.push(`- Minimum items: ${schema.minItems}`);
    if (schema.maxItems !== undefined)
      lines.push(`- Maximum items: ${schema.maxItems}`);
    if (schema.uniqueItems) lines.push(`- Items must be unique.`);

    return lines;
  }

  #ref($ref: string): string[] {
    const schemaName = $ref.split('/').pop() || 'object';
    const resolved = followRef<SchemaObject>(this.#spec, $ref);
    // Link to the schema definition (assuming heading anchors are generated elsewhere)
    const lines = [
      `**Type:** [\`${schemaName}\`](#${schemaName.toLowerCase()})`,
    ];
    if (resolved.description) {
      lines.push(resolved.description);
    }
    // Avoid deep recursion by default, just link and show description.
    // If more detail is needed, the linked definition should provide it.
    return lines;
  }

  #allOf(schemas: (SchemaObject | ReferenceObject)[]): string[] {
    const lines = ['**All of (Intersection):**'];
    schemas.forEach((subSchema, index) => {
      lines.push(`- **Constraint ${index + 1}:**`);
      const subLines = this.handle(subSchema);
      lines.push(...subLines.map((l) => `  ${l}`)); // Indent sub-schema docs
    });
    return lines;
  }

  #anyOf(schemas: (SchemaObject | ReferenceObject)[]): string[] {
    const lines = ['**Any of (Union):**'];
    schemas.forEach((subSchema, index) => {
      lines.push(`- **Option ${index + 1}:**`);
      const subLines = this.handle(subSchema);
      lines.push(...subLines.map((l) => `  ${l}`));
    });
    return lines;
  }

  #oneOf(schemas: (SchemaObject | ReferenceObject)[]): string[] {
    const lines = ['**One of (Exclusive Union):**'];
    schemas.forEach((subSchema, index) => {
      lines.push(`- **Option ${index + 1}:**`);
      const subLines = this.handle(subSchema);
      lines.push(...subLines.map((l) => `  ${l}`));
    });
    return lines;
  }

  #enum(schema: SchemaObject): string[] {
    const lines = [`**Type:** \`${schema.type || 'unknown'}\` (enum)`];
    if (schema.description) lines.push(schema.description);
    lines.push('**Allowed values:**');
    lines.push(
      ...(schema.enum || []).map((val) => `- \`${JSON.stringify(val)}\``),
    );
    if (schema.default !== undefined) {
      lines.push(`**Default:** \`${JSON.stringify(schema.default)}\``);
    }
    return lines;
  }

  #normal(type: string, schema: SchemaObject, nullable: boolean): string[] {
    const lines: string[] = [];
    const nullableSuffix = nullable ? ' (nullable)' : '';
    const description = schema.description ? [schema.description] : [];

    switch (type) {
      case 'string':
        lines.push(
          `**Type:** \`string\`${schema.format ? ` (format: ${schema.format})` : ''}${nullableSuffix}`,
        );
        lines.push(...description);
        if (schema.minLength !== undefined)
          lines.push(`- Minimum length: ${schema.minLength}`);
        if (schema.maxLength !== undefined)
          lines.push(`- Maximum length: ${schema.maxLength}`);
        if (schema.pattern !== undefined)
          lines.push(`- Pattern: \`${schema.pattern}\``);
        break;
      case 'number':
      case 'integer':
        lines.push(
          `**Type:** \`${type}\`${schema.format ? ` (format: ${schema.format})` : ''}${nullableSuffix}`,
        );
        lines.push(...description);
        // Add number constraints (OpenAPI 3.1)
        if (schema.minimum !== undefined) {
          // Check if exclusiveMinimum is a number (OAS 3.1)
          const exclusiveMin = typeof schema.exclusiveMinimum === 'number';
          lines.push(
            `- Minimum: ${schema.minimum}${exclusiveMin ? ' (exclusive)' : ''}`,
          );
          if (exclusiveMin) {
            lines.push(
              `- Must be strictly greater than: ${schema.exclusiveMinimum}`,
            );
          }
        } else if (typeof schema.exclusiveMinimum === 'number') {
          lines.push(
            `- Must be strictly greater than: ${schema.exclusiveMinimum}`,
          );
        }

        if (schema.maximum !== undefined) {
          // Check if exclusiveMaximum is a number (OAS 3.1)
          const exclusiveMax = typeof schema.exclusiveMaximum === 'number';
          lines.push(
            `- Maximum: ${schema.maximum}${exclusiveMax ? ' (exclusive)' : ''}`,
          );
          if (exclusiveMax) {
            lines.push(
              `- Must be strictly less than: ${schema.exclusiveMaximum}`,
            );
          }
        } else if (typeof schema.exclusiveMaximum === 'number') {
          lines.push(
            `- Must be strictly less than: ${schema.exclusiveMaximum}`,
          );
        }
        if (schema.multipleOf !== undefined)
          lines.push(`- Must be a multiple of: ${schema.multipleOf}`);
        break;
      case 'boolean':
        lines.push(`**Type:** \`boolean\`${nullableSuffix}`);
        lines.push(...description);
        break;
      case 'object':
        lines.push(`**Type:** \`object\`${nullableSuffix}`);
        lines.push(...description);
        lines.push(...this.#object(schema));
        break;
      case 'array':
        lines.push(`**Type:** \`array\`${nullableSuffix}`);
        lines.push(...description);
        lines.push(...this.#array(schema));
        break;
      case 'null':
        lines.push(`**Type:** \`null\``);
        lines.push(...description);
        break;
      default:
        lines.push(`**Type:** \`${type}\`${nullableSuffix}`);
        lines.push(...description);
    }
    if (schema.default !== undefined) {
      lines.push(`**Default:** \`${JSON.stringify(schema.default)}\``);
    }
    return lines.filter((l) => l); // Filter out empty description lines
  }

  /**
   * Handle schemas by resolving references and delegating to appropriate handler
   */
  public handle(schemaOrRef: SchemaObject | ReferenceObject): string[] {
    if (isRef(schemaOrRef)) {
      return this.#ref(schemaOrRef.$ref);
    }

    const schema = schemaOrRef;

    // Handle composition keywords first
    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.#allOf(schema.allOf);
    }
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.#anyOf(schema.anyOf);
    }
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      return this.#oneOf(schema.oneOf);
    }

    // Handle enums
    if (schema.enum && Array.isArray(schema.enum)) {
      return this.#enum(schema);
    }

    // Determine type(s) and nullability
    let types = coerceTypes(schema);
    let nullable = false; // Default to false

    if (types.includes('null')) {
      nullable = true;
      types = types.filter((t) => t !== 'null');
    }

    // Infer type if not explicitly set
    if (types.length === 0) {
      if (schema.properties || schema.additionalProperties) {
        types = ['object'];
      } else if (schema.items) {
        types = ['array'];
      }
      // Add other inferences if needed (e.g., based on format)
    }

    // If still no type, treat as unknown or any
    if (types.length === 0) {
      const lines = ['**Type:** `unknown`'];
      if (schema.description) lines.push(schema.description);
      if (schema.default !== undefined)
        lines.push(`**Default:** \`${JSON.stringify(schema.default)}\``);
      return lines;
    }

    // Handle single type (potentially nullable)
    if (types.length === 1) {
      return this.#normal(types[0], schema, nullable);
    }

    // Handle union of multiple non-null types (potentially nullable overall)
    const typeString = types.join(' | ');
    const nullableSuffix = nullable ? ' (nullable)' : '';
    const lines = [`**Type:** \`${typeString}\`${nullableSuffix}`];
    if (schema.description) lines.push(schema.description);
    if (schema.default !== undefined)
      lines.push(`**Default:** \`${JSON.stringify(schema.default)}\``);
    return lines;
  }

  /**
   * Process a request body and return markdown documentation
   */
  requestBody(requestBody?: RequestBodyObject): string[] {
    if (!requestBody) return [];

    const lines: string[] = [];
    lines.push(`##### Request Body`);

    if (requestBody.description) {
      lines.push(requestBody.description);
    }
    if (requestBody.required) {
      lines.push(`*This request body is required.*`);
    }

    if (requestBody.content) {
      for (const [contentType, mediaType] of Object.entries(
        requestBody.content,
      )) {
        lines.push(`**Content Type:** \`${contentType}\``);

        if (mediaType.schema) {
          // Use the main handle method here
          const schemaDocs = this.handle(mediaType.schema);
          lines.push(...schemaDocs); // Add schema docs directly
        }
      }
    }

    return lines;
  }
}
