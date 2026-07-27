import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { isEmpty, isRef, joinSkipDigits, pascalcase } from '@sdk-it/core';

import type { Varient } from '../find-polymorphic-varients.js';
import { findUniqueSchemaName } from '../find-unique-schema-name.js';
import type { ProcessingPlugin } from '../processing.js';
import type { IR } from '../types.js';

function extractInlineSchemaComponents(
  spec: IR,
  schemas: Record<string, SchemaObject | ReferenceObject>,
) {
  for (const [name, schema] of Object.entries(schemas)) {
    if (isRef(schema)) continue;

    if (!isEmpty(schema.properties)) {
      if (!isEmpty(schema.oneOf)) {
        for (const oneOfIndex in schema.oneOf) {
          const oneOf = schema.oneOf[oneOfIndex];
          if (isRef(oneOf)) continue;
          for (const key of ['properties', 'x-properties'] as const) {
            if (!isEmpty(oneOf.required) && schema[key]) {
              schema.oneOf[oneOfIndex] = schema[key][oneOf.required[0]];
            }
          }
        }
        delete schema.type;
        extractInlineSchemaComponents(spec, schemas);
        continue;
      }
      if (schema.additionalProperties) {
        continue;
      }
      spec.components.schemas[name] = schema;
      const properties = schema.properties as Record<
        string,
        SchemaObject | ReferenceObject
      >;
      for (const [propertyName, value] of Object.entries(properties)) {
        if (isRef(value)) continue;

        const fixedPropertyName = propertyName.replace('[]', '');
        const refName = findUniqueSchemaName(
          spec,
          pascalcase(joinSkipDigits([name, fixedPropertyName], ' ')),
          ['Property', 'Field', 'Attribute'],
        );

        if (!isEmpty(value.properties)) {
          spec.components.schemas[refName] = value;
          properties[propertyName] = {
            $ref: `#/components/schemas/${refName}`,
          };
          extractInlineSchemaComponents(spec, { [refName]: value });
        } else if (!isEmpty(value.oneOf)) {
          extractInlineUnion(spec, name, value, 'oneOf');

          spec.components.schemas[refName] = value;
          properties[propertyName] = {
            $ref: `#/components/schemas/${refName}`,
          };
          extractInlineSchemaComponents(spec, { [refName]: value });
        } else if (!isEmpty(value.anyOf)) {
          extractInlineUnion(spec, name, value, 'anyOf');

          spec.components.schemas[refName] = value;
          properties[propertyName] = {
            $ref: `#/components/schemas/${refName}`,
          };
          extractInlineSchemaComponents(spec, { [refName]: value });
        } else {
          extractInlineSchemaComponents(spec, { [refName]: value });
        }
      }

      continue;
    }
    if (!isEmpty(schema['x-properties'])) {
      spec.components.schemas[name] = schema;

      const properties = schema['x-properties'] as Record<
        string,
        SchemaObject | ReferenceObject
      >;
      for (const [propertyName, value] of Object.entries(properties)) {
        if (isRef(value)) continue;

        const fixedPropertyName = propertyName.replace('[]', '');
        const refName = findUniqueSchemaName(
          spec,
          pascalcase(joinSkipDigits([name, fixedPropertyName], ' ')),
          ['Property', 'Field', 'Attribute'],
        );

        if (!isEmpty(value.properties)) {
          spec.components.schemas[refName] = value;
          properties[propertyName] = {
            $ref: `#/components/schemas/${refName}`,
          };
          extractInlineSchemaComponents(spec, { [refName]: value });
        } else if (!isEmpty(value.oneOf)) {
          extractInlineUnion(spec, name, value, 'oneOf');

          spec.components.schemas[refName] = value;
          properties[propertyName] = {
            $ref: `#/components/schemas/${refName}`,
          };
          extractInlineSchemaComponents(spec, { [refName]: value });
        } else if (!isEmpty(value.anyOf)) {
          extractInlineUnion(spec, name, value, 'anyOf');

          spec.components.schemas[refName] = value;
          properties[propertyName] = {
            $ref: `#/components/schemas/${refName}`,
          };
          extractInlineSchemaComponents(spec, { [refName]: value });
        } else {
          extractInlineSchemaComponents(spec, { [refName]: value });
        }
      }
      continue;
    }

    if (schema.type === 'array') {
      if (isRef(schema.items) || isEmpty(schema.items)) continue;
      const refName = findUniqueSchemaName(spec, name, ['Item', 'Entry']);
      if (schema.items.type === 'object') {
        spec.components.schemas[refName] = schema.items;
        extractInlineSchemaComponents(spec, { [refName]: schema.items });
        schema.items = { $ref: `#/components/schemas/${refName}` };
        continue;
      }
      if (schema.items.type === 'array') {
        extractInlineSchemaComponents(spec, { [refName]: schema.items });
        continue;
      }
      if (!isEmpty(schema.items.oneOf)) {
        extractInlineUnion(spec, refName, schema.items, 'oneOf');
        continue;
      }
      if (!isEmpty(schema.items.anyOf)) {
        extractInlineUnion(spec, refName, schema.items, 'anyOf');
        continue;
      }
    }
    if (!isEmpty(schema.oneOf)) {
      extractInlineUnion(spec, name, schema, 'oneOf');
      continue;
    }
    if (!isEmpty(schema.anyOf)) {
      extractInlineUnion(spec, name, schema, 'anyOf');
    }
  }
}

function extractInlineUnion(
  spec: IR,
  name: string,
  schema: SchemaObject,
  kind: 'oneOf' | 'anyOf',
) {
  const varients = schema['x-varients'] as Varient[];
  if (!varients || varients.length === 0) {
    console.warn(
      `No varients found for ${name}. This might be an error in the OpenAPI spec.`,
    );
  }
  varients.forEach((varient) => {
    const varientSchema = schema[kind]![varient.position];
    if (isRef(varientSchema)) return;
    const refName = findUniqueSchemaName(
      spec,
      pascalcase(`${name} ${varient.name}`),
      ['Varient'],
    );

    if (varientSchema.type === 'object') {
      spec.components.schemas[refName] = varientSchema;
      extractInlineSchemaComponents(spec, { [refName]: varientSchema });
      schema[kind]![varient.position] = {
        $ref: `#/components/schemas/${refName}`,
      };
    } else {
      extractInlineSchemaComponents(spec, { [refName]: varientSchema });
    }
  });
}

export function extractInlineSchemas(): ProcessingPlugin {
  return {
    name: 'extract-inline-schemas',
    process({ spec }) {
      extractInlineSchemaComponents(spec, spec.components.schemas);
    },
  };
}
