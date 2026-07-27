import { merge, uniq } from 'lodash-es';
import assert from 'node:assert';
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { isEmpty, isRef, notRef, resolveRef, snakecase } from '@sdk-it/core';

import { findVarients } from '../find-polymorphic-varients.js';
import { formatName } from '../format-name.js';
import { isPrimitiveSchema } from '../is-primitive-schema.js';
import type { ProcessingPlugin } from '../processing.js';
import type { IR } from '../types.js';

function normalizeSchemaObjects(
  spec: IR,
  schemas: (SchemaObject | ReferenceObject)[],
  visited = new Set<string>(),
) {
  for (const schema of schemas) {
    if (isRef(schema)) continue;

    if (!isEmpty(schema.properties)) {
      schema.type = 'object';
      delete schema.oneOf;
      delete schema.anyOf;
      normalizeSchemaObjects(spec, Object.values(schema.properties), visited);
      for (const [key, value] of Object.entries(schema.properties)) {
        if (notRef(value) && isPrimitiveSchema(value)) {
          value.default ??= schema.default?.[key];
          delete schema.default?.[key];
        }
      }
      delete schema.default;
    }

    if (!isEmpty(schema['x-properties'])) {
      normalizeSchemaObjects(
        spec,
        Object.values(schema['x-properties']),
        visited,
      );
    }

    if (!isEmpty(schema.items)) {
      delete schema.oneOf;
      delete schema.anyOf;
      schema.type = 'array';
      normalizeSchemaObjects(spec, [schema.items], visited);
      const items = resolveRef<SchemaObject>(spec, schema.items);
      if (Array.isArray(items.default)) {
        schema.default ??= structuredClone(items.default);
      }
      delete items.default;
    }

    if (!isEmpty(schema.anyOf) && !isEmpty(schema.oneOf)) {
      delete schema.anyOf;
    }

    if (isEmpty(schema.enum)) {
      delete schema.enum;
    }

    if (!isEmpty(schema.enum)) {
      if (schema.enum.length === 1) {
        schema.const = schema.enum[0];
        delete schema.enum;
      } else {
        const valuesSet = new Set<string>();
        const valuesList = [];
        for (const value of schema.enum) {
          const formattedValue = formatName(snakecase(formatName(value)));
          if (!valuesSet.has(formattedValue)) {
            valuesSet.add(formattedValue);
            valuesList.push(value);
          }
        }
        schema.enum = valuesList;
      }
      delete schema.allOf;
    }

    if (schema.const !== undefined) {
      schema.default = schema.const;
    }

    if (!isEmpty(schema.allOf)) {
      const schemas = schema.allOf;
      const resolved = schemas.map((item) =>
        resolveRef<SchemaObject>(spec, item),
      );
      const hasObjects = resolved.some((item) => item.type === 'object');
      const hasOtherTypes = resolved.some(
        (item) => item.type && item.type !== 'object',
      );
      if (hasObjects && hasOtherTypes) {
        assert(false, `allOf must be an object`);
      }
      merge(
        schema,
        ...resolved.map((resolvedSchema, index) => {
          const sourceSchema = schemas[index];
          if (isRef(sourceSchema)) {
            if (visited.has(sourceSchema.$ref)) {
              throw new Error(
                `Circular allOf reference detected: ${[
                  ...visited,
                  sourceSchema.$ref,
                ].join(' -> ')}`,
              );
            }
            normalizeSchemaObjects(
              spec,
              [resolvedSchema],
              new Set(visited).add(sourceSchema.$ref),
            );
          } else {
            normalizeSchemaObjects(spec, [resolvedSchema], visited);
          }
          return resolvedSchema;
        }),
      );
      delete schema.allOf;
    } else {
      delete schema.allOf;
    }

    if (
      schema.type === 'object' &&
      isEmpty(schema.properties) &&
      typeof schema.additionalProperties === 'object' &&
      !isEmpty(schema.additionalProperties) &&
      notRef(schema.additionalProperties) &&
      !isEmpty(schema.additionalProperties.properties)
    ) {
      normalizeSchemaObjects(
        spec,
        Object.values(schema.additionalProperties.properties),
        visited,
      );
    }

    for (const kind of ['oneOf', 'anyOf'] as const) {
      if (!isEmpty(schema[kind])) {
        delete schema.type;
        normalizeSchemaObjects(spec, schema[kind], visited);
        if (isEmpty(schema[kind])) {
          continue;
        }

        let enumSchemaIndex = -1;
        const enumValues: string[] = [];
        for (let index = 0; index < schema[kind].length; index++) {
          const item = schema[kind][index];
          if (notRef(item) && item.type === 'string') {
            if (item.enum && item.enum.length > 1) {
              enumValues.push(...item.enum);
              if (enumSchemaIndex === -1) {
                enumSchemaIndex = index;
              }
            }
          }
        }
        if (enumSchemaIndex !== -1) {
          const enumSchema = schema[kind][enumSchemaIndex];
          if (notRef(enumSchema)) {
            enumSchema.enum = uniq(enumValues);
          }
          schema[kind] = schema[kind].filter(
            (item, index) => index === enumSchemaIndex || isRef(item),
          );
        }
        const otherTypes = schema[kind].filter(
          (item) => resolveRef<SchemaObject>(spec, item).type !== 'null',
        );
        if (otherTypes.length === 1) {
          Object.assign(schema, otherTypes[0]);
          delete schema[kind];
          continue;
        }

        schema['x-varients'] = findVarients(spec, schema[kind]);
      } else {
        delete schema[kind];
      }
    }
  }
}

export function normalizeSchemas(): ProcessingPlugin {
  return {
    name: 'normalize-schemas',
    process({ spec }) {
      normalizeSchemaObjects(spec, Object.values(spec.components.schemas));
    },
  };
}
