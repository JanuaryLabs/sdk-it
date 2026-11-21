import type {
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { type OpenAPIDocument, isRef } from '@sdk-it/core';
import { annotationsOf, coerceTypes } from '@sdk-it/spec';

/**
 * PropEmitter handles converting OpenAPI schemas to Markdown documentation
 */
export class PropEmitter {
  #spec: OpenAPIDocument;

  constructor(spec: OpenAPIDocument) {
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

    const fixed = this.#fixedSummary(schema);

    const reqMark = required ? ' required' : '';
    const summary = `- \`${name}\` ${rawType}${reqMark}${fixed}:`;

    // assemble final lines (skip the type and the value or default the summary shows)
    const detailLines = docs
      .slice(1)
      .filter(
        (it) => !it.startsWith('**Value:**') && !it.startsWith('**Default:**'),
      )
      .map((it) => `  ${it}`);

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

  #ref(schema: ReferenceObject): string[] {
    const schemaName = schema.$ref.split('/').pop() || 'object';
    const annotations = annotationsOf(schema, this.#spec);
    const lines = [
      `**Type:** [\`${schemaName}\`](#${schemaName.toLowerCase()})`,
    ];
    if (annotations.description) {
      lines.push(annotations.description);
    }
    if (annotations.default !== undefined) {
      lines.push(`**Default:** \`${JSON.stringify(annotations.default)}\``);
    }
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

  #fixedSummary(schema: SchemaObject | ReferenceObject): string {
    if (!isRef(schema) && schema.const !== undefined) {
      return ` value: ${JSON.stringify(schema.const)}`;
    }
    const { default: value } = annotationsOf(schema, this.#spec);
    if (value !== undefined) {
      return ` default: ${JSON.stringify(value)}`;
    }
    return '';
  }

  #fixedLines(schema: SchemaObject): string[] {
    const lines: string[] = [];
    if (schema.const !== undefined) {
      lines.push(`**Value:** \`${JSON.stringify(schema.const)}\``);
    }
    if (schema.default !== undefined) {
      lines.push(`**Default:** \`${JSON.stringify(schema.default)}\``);
    }
    return lines;
  }

  #discriminator(schema: SchemaObject): string[] {
    return schema.discriminator
      ? [`**Discriminator:** \`${schema.discriminator.propertyName}\``]
      : [];
  }

  #anyOf(
    schema: SchemaObject,
    schemas: (SchemaObject | ReferenceObject)[],
  ): string[] {
    const lines = ['**Any of (Union):**', ...this.#discriminator(schema)];
    schemas.forEach((subSchema, index) => {
      lines.push(`- **Option ${index + 1}:**`);
      const subLines = this.handle(subSchema);
      lines.push(...subLines.map((l) => `  ${l}`));
    });
    return lines;
  }

  #oneOf(
    schema: SchemaObject,
    schemas: (SchemaObject | ReferenceObject)[],
  ): string[] {
    const lines = [
      '**One of (Exclusive Union):**',
      ...this.#discriminator(schema),
    ];
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
    lines.push(...this.#fixedLines(schema));
    return lines.filter((l) => l); // Filter out empty description lines
  }

  /**
   * Handle schemas by resolving references and delegating to appropriate handler
   */
  public handle(schemaOrRef: SchemaObject | ReferenceObject): string[] {
    const [type, ...details] = this.#describe(schemaOrRef);
    return annotationsOf(schemaOrRef, this.#spec).deprecated
      ? [type, '**Deprecated**', ...details]
      : [type, ...details];
  }

  #describe(schemaOrRef: SchemaObject | ReferenceObject): string[] {
    if (isRef(schemaOrRef)) {
      return this.#ref(schemaOrRef);
    }

    const schema = schemaOrRef;

    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.#allOf(schema.allOf);
    }
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.#anyOf(schema, schema.anyOf);
    }
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      return this.#oneOf(schema, schema.oneOf);
    }

    if (schema.enum && Array.isArray(schema.enum)) {
      return this.#enum(schema);
    }

    let types = coerceTypes(schema);
    let nullable = false; // Default to false

    if (types.includes('null')) {
      nullable = true;
      types = types.filter((t) => t !== 'null');
    }

    if (types.length === 0) {
      if (schema.properties || schema.additionalProperties) {
        types = ['object'];
      } else if (schema.items) {
        types = ['array'];
      }
    }

    if (types.length === 0) {
      const lines = ['**Type:** `unknown`'];
      if (schema.description) lines.push(schema.description);
      lines.push(...this.#fixedLines(schema));
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
    lines.push(...this.#fixedLines(schema));
    return lines;
  }

  /** The documentation of a request body, one block per content type. */
  requestBody(requestBody: RequestBodyObject): string[] {
    const lines: string[] = [];
    if (requestBody.description) {
      lines.push(requestBody.description);
    }

    const contentEntries = Object.entries(requestBody.content);
    if (contentEntries.length > 1) {
      for (const [contentType, mediaType] of contentEntries) {
        lines.push(`<details>`);
        lines.push(`<summary>Content Type: \`${contentType}\`</summary>`);
        lines.push('');
        if (mediaType.schema) {
          lines.push(...this.handle(mediaType.schema));
        }
        lines.push('');
        lines.push(`</details>`);
      }
      return lines;
    }

    const [[contentType, mediaType]] = contentEntries;
    lines.push(`Content Type: \`${contentType}\``);
    if (mediaType.schema) {
      lines.push(...this.handle(mediaType.schema));
    }
    return lines;
  }

  /** A table of the operation's path, query, header and cookie parameters. */
  parameters(parameters: readonly ParameterObject[]): string[] {
    if (parameters.length === 0) {
      return [];
    }
    return [
      [
        '| Name | In | Type | Required | Description |',
        '|------|----|------|----------|-------------|',
        ...parameters.map((parameter) =>
          [
            '',
            `\`${parameter.name}\``,
            parameter.in,
            parameter.schema
              ? `${this.handle(parameter.schema)[0].replace('**Type:** ', '')}${this.#fixedSummary(parameter.schema)}`
              : '',
            parameter.required ? 'Yes' : 'No',
            (parameter.description ?? '').replaceAll('\n', ' '),
            '',
          ]
            .map((cell) => cell.replaceAll('|', '\\|'))
            .join(' | ')
            .trim(),
        ),
      ].join('\n'),
    ];
  }
}
