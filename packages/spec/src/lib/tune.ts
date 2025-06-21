import { merge, uniq } from 'lodash-es';
import assert from 'node:assert';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
  SchemaObjectType,
} from 'openapi3-ts/oas31';

import {
  isEmpty,
  isRef,
  joinSkipDigits,
  notRef,
  pascalcase,
  resolveRef,
  snakecase,
} from '@sdk-it/core';

import { type Varient, findVarients } from './find-polymorphic-varients.ts';
import { findUniqueSchemaName } from './find-unique-schema-name.ts';
import { formatName } from './format-name.ts';
import type { OurOpenAPIObject } from './operation.ts';

export function fixSpec(
  spec: OurOpenAPIObject,
  schemas: (SchemaObject | ReferenceObject)[],
  visited = new Set<string>(),
) {
  for (const schema of schemas) {
    if (isRef(schema)) continue;

    if (!isEmpty(schema.properties)) {
      schema.type = 'object';
      delete schema.oneOf;
      delete schema.anyOf;
      fixSpec(spec, Object.values(schema.properties), visited);
    }

    if (!isEmpty(schema['x-properties'])) {
      fixSpec(spec, Object.values(schema['x-properties']), visited);
    }

    if (!isEmpty(schema.items)) {
      delete schema.oneOf;
      delete schema.anyOf;
      schema.type = 'array';
      fixSpec(spec, [schema.items], visited);
      const items = resolveRef<SchemaObject>(spec, schema.items);
      if (Array.isArray(items.default)) {
        schema.default ??= structuredClone(items.default);
      }
      delete items.default; // default should not be in items
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
        for (const it of schema.enum) {
          const formattedValue = formatName(snakecase(formatName(it)));
          if (!valuesSet.has(formattedValue)) {
            valuesSet.add(formattedValue);
            valuesList.push(it);
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
      // if (schemas.length === 1) {
      //   fixSpec(spec, [schemas[0]], visited);
      //   Object.assign(schema, schemas[0]);
      //   delete schema.allOf;
      // } else {
      // }
      const resolved = schemas.map((it) => resolveRef<SchemaObject>(spec, it));
      const hasObjects = resolved.some((it) => it.type === 'object');
      const hasOtherTypes = resolved.some(
        (it) => it.type && it.type !== 'object',
      );
      if (hasObjects && hasOtherTypes) {
        assert(false, `allOf must be an object`);
      }
      merge(
        schema,
        ...resolved.map((it) => {
          fixSpec(spec, [it], visited);
          return it;
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
      // additionalProperties is of type object and properties is empty
      fixSpec(
        spec,
        Object.values(schema.additionalProperties.properties),
        visited,
      );
      Object.assign(schema, schema.additionalProperties);
      delete schema.additionalProperties;
    }

    for (const kind of ['oneOf', 'anyOf'] as const) {
      if (!isEmpty(schema[kind])) {
        delete schema.type; // type is not allowed with oneOf or anyOf
        fixSpec(spec, schema[kind], visited);
        if (isEmpty(schema[kind])) {
          // fixSpec can remove oneOf or anyOf if it has no items so we need to check again
          // after fixing
          continue;
        }

        let enumSchemaIndex = -1;
        const enumValues: string[] = [];
        for (let idx = 0; idx < schema[kind].length; idx++) {
          // for (const idx in schema[kind]) {
          const item = schema[kind][idx];
          // just handle non ref for now
          if (notRef(item) && item.type === 'string') {
            // if enum equal one it'd already have been converted to const so check for more than one
            if (item.enum && item.enum.length > 1) {
              // foundEnum = true;
              enumValues.push(...item.enum);
              if (enumSchemaIndex === -1) {
                enumSchemaIndex = idx;
              }
            }
          }
        }
        if (enumSchemaIndex !== -1) {
          const enumSchema = schema[kind][enumSchemaIndex];
          if (notRef(enumSchema)) {
            enumSchema.enum = uniq(enumValues);
          }
          // delete the other schemas that have enum
          schema[kind] = schema[kind].filter(
            (it, idx) => idx === enumSchemaIndex || isRef(it),
          );
        }
        const otherTypes = schema[kind].filter(
          (it) => resolveRef<SchemaObject>(spec, it).type !== 'null',
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

type Refs = { name: string; value: SchemaObject }[];

export function expandSpec(
  spec: OurOpenAPIObject,
  schemas: Record<string, SchemaObject | ReferenceObject>,
  refs: Refs,
) {
  for (const [name, schema] of Object.entries(schemas)) {
    if (isRef(schema)) continue;

    if (!isEmpty(schema.properties)) {
      if (!isEmpty(schema.oneOf)) {
        for (const oneOfIdx in schema.oneOf) {
          const oneOf = schema.oneOf[oneOfIdx];
          if (isRef(oneOf)) continue;
          for (const key of ['properties', 'x-properties'] as const) {
            if (!isEmpty(oneOf.required) && schema[key]) {
              schema.oneOf[oneOfIdx] = schema[key][oneOf.required[0]];
            }
          }
        }
        delete schema.type;
        expandSpec(spec, schemas, refs);
        continue;
      }
      if (schema.additionalProperties) {
        continue;
      }
      // refs.push({ name, value: schema });
      spec.components.schemas[name] = schema;
      const properties = schema.properties as Record<
        string,
        SchemaObject | ReferenceObject
      >;
      for (const [propName, value] of Object.entries(properties)) {
        if (isRef(value)) continue;

        const fixedPropName = propName.replace('[]', '');
        // this neeeds inheritance logic first otherwise it'll create class mess
        // const refName = findUniqueSchemaName(
        //   spec,
        //   propName,
        //   ['Property', 'Field', 'Attribute'],
        //   pascalcase(joinSkipDigits([name, fixedPropName], ' ')),
        // );
        const refName = pascalcase(joinSkipDigits([name, fixedPropName], ' '));

        if (!isEmpty(value.properties)) {
          // refs.push({ name: refName, value: value });
          spec.components.schemas[refName] = value;
          properties[propName] = { $ref: `#/components/schemas/${refName}` };
          expandSpec(spec, { [refName]: value }, refs);
        } else if (!isEmpty(value.oneOf)) {
          expandOneOf(spec, name, value, refs, 'oneOf');

          spec.components.schemas[refName] = value;
          properties[propName] = { $ref: `#/components/schemas/${refName}` };
          expandSpec(spec, { [refName]: value }, refs);
        } else if (!isEmpty(value.anyOf)) {
          expandOneOf(spec, name, value, refs, 'anyOf');

          spec.components.schemas[refName] = value;
          properties[propName] = { $ref: `#/components/schemas/${refName}` };
          expandSpec(spec, { [refName]: value }, refs);
        } else {
          expandSpec(spec, { [refName]: value }, refs);
        }
      }

      continue;
    }
    if (!isEmpty(schema['x-properties'])) {
      // refs.push({ name, value: schema });
      spec.components.schemas[name] = schema;

      const properties = schema['x-properties'] as Record<
        string,
        SchemaObject | ReferenceObject
      >;
      for (const [propName, value] of Object.entries(properties)) {
        if (isRef(value)) continue;

        const fixedPropName = propName.replace('[]', '');
        // this neeeds inheritance logic first otherwise it'll create class mess
        // const refName = findUniqueSchemaName(
        //   spec,
        //   propName,
        //   ['Property', 'Field', 'Attribute'],
        //   pascalcase(joinSkipDigits([name, fixedPropName], ' ')),
        // );
        const refName = pascalcase(joinSkipDigits([name, fixedPropName], ' '));

        if (!isEmpty(value.properties)) {
          // refs.push({ name: refName, value: value });
          spec.components.schemas[refName] = value;
          properties[propName] = { $ref: `#/components/schemas/${refName}` };
          expandSpec(spec, { [refName]: value }, refs);
        } else if (!isEmpty(value.oneOf)) {
          expandOneOf(spec, name, value, refs, 'oneOf');

          spec.components.schemas[refName] = value;
          properties[propName] = { $ref: `#/components/schemas/${refName}` };
          expandSpec(spec, { [refName]: value }, refs);
        } else if (!isEmpty(value.anyOf)) {
          expandOneOf(spec, name, value, refs, 'anyOf');

          spec.components.schemas[refName] = value;
          properties[propName] = { $ref: `#/components/schemas/${refName}` };
          expandSpec(spec, { [refName]: value }, refs);
        } else {
          expandSpec(spec, { [refName]: value }, refs);
        }
      }
      continue;
    }

    if (schema.type === 'array') {
      if (isRef(schema.items)) continue;
      if (isEmpty(schema.items)) continue;
      const refName = findUniqueSchemaName(spec, name, ['Item', 'Entry']);
      if (schema.items.type === 'object') {
        // const refName = findUniqueSchemaName(spec, name, ['Object']);
        // refs.push({ name: refName, value: schema.items });
        spec.components.schemas[refName] = schema.items;
        expandSpec(spec, { [refName]: schema.items }, refs);
        schema.items = { $ref: `#/components/schemas/${refName}` };
        continue;
      }
      if (schema.items.type === 'array') {
        // for nested arrays, we need to move the last nested items only
        // so {type: 'array', items: { type: 'array', items: { type: 'object', properties: ... } }}
        // only object schema is moved while the array hirarchy is intact.
        expandSpec(spec, { [refName]: schema.items }, refs);
        continue;
      }
      if (!isEmpty(schema.items.oneOf)) {
        expandOneOf(spec, refName, schema.items, refs, 'oneOf');
        continue;
      }
      if (!isEmpty(schema.items.anyOf)) {
        expandOneOf(spec, refName, schema.items, refs, 'anyOf');
        continue;
      }
    }
    if (!isEmpty(schema.oneOf)) {
      expandOneOf(spec, name, schema, refs, 'oneOf');
      continue;
    }
    if (!isEmpty(schema.anyOf)) {
      expandOneOf(spec, name, schema, refs, 'anyOf');
      continue;
    }
  }
}

function expandOneOf(
  spec: OurOpenAPIObject,
  name: string,
  schema: SchemaObject,
  refs: Refs,
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
      expandSpec(spec, { [refName]: varientSchema }, refs);
      schema[kind]![varient.position] = {
        $ref: `#/components/schemas/${refName}`,
      };
    } else {
      expandSpec(spec, { [refName]: varientSchema }, refs);
    }

    // const referable = (['array', 'object'] as SchemaObjectType[]).some((type) =>
    //   coerceTypes(varientSchema).includes(type),
    // );
    // if (!referable) {
    //   return;
    // }
  });
}

export function coerceTypes(
  schema: SchemaObject,
  excludeNull = true,
): SchemaObjectType[] {
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (excludeNull) {
    return types.filter((type) => type !== 'null');
  }
  return types;
}
