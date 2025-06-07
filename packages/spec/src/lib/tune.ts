import { merge } from 'lodash-es';
import assert from 'node:assert';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
  SchemaObjectType,
} from 'openapi3-ts/oas31';

import {
  followRef,
  isEmpty,
  isRef,
  joinSkipDigits,
  notRef,
  pascalcase,
  resolveRef,
} from '@sdk-it/core';

export function fixSpec(
  spec: OpenAPIObject,
  schemas: Record<string, SchemaObject | ReferenceObject>,
) {
  for (const [name, schemaOrRef] of Object.entries(schemas)) {
    const schema = isRef(schemaOrRef)
      ? followRef(spec, schemaOrRef.$ref)
      : schemaOrRef;

    if (!isEmpty(schema.properties) && (schema.oneOf || schema.anyOf)) {
      // fix invalid schema
      console.log(`Fixing properties for ${name}`);
      delete schema.oneOf;
      delete schema.anyOf;
      schema.type = 'object';

      fixSpec(spec, schema.properties);
    }

    if (!isEmpty(schema.items)) {
      console.log(`Fixing items for ${name}`);
      delete schema.oneOf;
      delete schema.anyOf;
      schema.type = 'array';
    }

    if (!isEmpty(schema.anyOf) && !isEmpty(schema.oneOf)) {
      delete schema.anyOf;
    }

    if (!isEmpty(schema.allOf)) {
      console.log(`Fixing allOf for ${name}`);
      const schemas = schema.allOf;
      const refs = schemas.filter(isRef);
      const nonrefs = schemas.filter(notRef);
      if (nonrefs.some((it) => it.type && it.type !== 'object')) {
        assert(false, `allOf ${name} must be an object`);
      }
      merge(
        schema,
        ...nonrefs,
        ...refs.map((ref) => {
          const schemas = { $1: followRef(spec, ref.$ref) };
          fixSpec(spec, schemas);
          return schemas.$1;
        }),
      );
      delete schema.allOf;
    }

    if (!isEmpty(schema.anyOf)) {
      console.log(`Fixing anyOf for ${name}`);
      const { varients } = findVarients(
        spec,
        schema.anyOf.map((it) => resolveRef<SchemaObject>(spec, it)),
      );
      // console.log(
      //   `Found ${varients.length} varients for ${name}: ${varients.join(', ')}`,
      // );
      schema['x-varients'] = varients;
    }

    if (!isEmpty(schema.oneOf)) {
      console.log(`Fixing oneOf for ${name}`);
      const { varients } = findVarients(
        spec,
        schema.oneOf.map((it) => resolveRef<SchemaObject>(spec, it)),
      );
      // console.log(
      //   `Found ${varients.length} varients for ${name}: ${varients.join(', ')}`,
      // );
      schema['x-varients'] = varients;
    }

    if (schema.type === 'object' && !isEmpty(schema.properties)) {
      fixSpec(spec, schema.properties);
    }
    if (schema.type === 'array' && notRef(schema.items)) {
      fixSpec(spec, { $1: schema.items });
    }
  }
}

type Refs = { name: string; value: SchemaObject }[];
export function expandSpec(
  spec: OpenAPIObject,
  schemas: Record<string, SchemaObject | ReferenceObject>,
  refs: Refs,
) {
  for (const [name, schemaOrRef] of Object.entries(schemas)) {
    const schema = resolveRef<SchemaObject>(spec, schemaOrRef);
    if (schema.type === 'object') {
      if (!isEmpty(schema.oneOf)) {
        for (const oneOfIdx in schema.oneOf) {
          const oneOf = schema.oneOf[oneOfIdx];
          if (isRef(oneOf)) continue;
          if (!isEmpty(oneOf.required) && schema.properties) {
            schema.oneOf[oneOfIdx] = schema.properties[oneOf.required[0]];
          }
        }
        delete schema.type;
        expandSpec(spec, schemas, refs);
        continue;
      }
      if (schema.additionalProperties) {
        continue;
      }
      if (isEmpty(schema.properties)) {
        continue;
      }
      refs.push({ name, value: schema });

      for (const [propName, value] of Object.entries(schema.properties)) {
        if (isRef(value)) continue;

        if (!isEmpty(value.properties)) {
          const refName = pascalcase(
            joinSkipDigits([name, propName.replace('[]', '')], ' '),
          );
          refs.push({ name: refName, value: value });

          schema.properties[propName] = {
            $ref: `#/components/schemas/${refName}`,
          };

          expandSpec(spec, { [refName]: value }, refs);
        } else {
          const refName = pascalcase(
            joinSkipDigits([name, propName.replace('[]', '')], ' '),
          );
          expandSpec(spec, { [refName]: value }, refs);
        }
      }

      continue;
    }

    if (schema.type === 'array') {
      if (isRef(schema.items)) continue;
      const refName = `${name}Entry`;
      if (schema.items?.type === 'object') {
        refs.push({ name: refName, value: schema.items });
        expandSpec(spec, { [refName]: schema.items }, refs);
        schema.items = { $ref: `#/components/schemas/${refName}` };
        continue;
      }
      if (schema.items&&!isEmpty(schema.items.oneOf)) {
        expandOneOf(spec, refName, schema.items, refs);
        continue;
      }
    }
    if (!isEmpty(schema.oneOf)) {
      expandOneOf(spec, name, schema, refs);
    }
  }
}

function expandOneOf(
  spec: OpenAPIObject,
  name: string,
  schema: SchemaObject,
  refs: Refs,
) {
  const varients = schema['x-varients'] as Varient[];
  varients.forEach((varient, index) => {
    const varientSchema = schema.oneOf![index];
    if (isRef(varientSchema)) return;
    const refName = pascalcase(`${name} ${varient.name}`);
    // refs.push({ name: refName, value: varientSchema });
    expandSpec(spec, { [refName]: varientSchema }, refs);
  });
}

export type Varient = {
  name: string;
  type: string;
  source?: string;
  static?: boolean;
  subtype?: string;
};

function findVarients(spec: OpenAPIObject, schemas: SchemaObject[]) {
  // todo: take a look at CompoundFilterFilters at the end
  const varients: { name: string; type: string }[] = [];
  if (schemas.length === 0) {
    return { varients: [], discriminatorProp: undefined };
  }

  const schemasByType = schemas.reduce<
    Partial<Record<SchemaObjectType, SchemaObject[]>>
  >((acc, schema) => {
    const [type] = coerceTypes(schema);
    acc[type] ??= [];
    acc[type].push(schema);
    return acc;
  }, {});

  if (!isEmpty(schemasByType.string)) {
    for (const schema of schemasByType.string) {
      if (schema.format) {
        varients.push({ name: schema.format, type: 'string' });
        continue;
      }
      if (!isEmpty(schema.enum)) {
        for (const enumValue of schema.enum) {
          if (enumValue === '') {
            varients.push({ name: 'empty', type: 'string' });
            continue;
          }
          varients.push({
            name: enumValue,
            type: 'string',
          });
        }
        continue;
      }

      varients.push({ name: 'text', type: 'string' });
    }
    return { varients: varients, discriminatorProp: undefined };
  }

  if (!isEmpty(schemasByType.array)) {
    for (const schema of schemasByType.array) {
      const items = schema.items ? resolveRef(spec, schema.items) : undefined;
      if (!items) {
        varients.push({ name: 'any', type: 'array' });
        continue;
      }
      const [type] = coerceTypes(items);
      if (type === 'string') {
        varients.push({ name: 'text', type: 'array' });
        continue;
      }
      if (type === 'object') {
        varients.push({ name: 'object', type: 'array' });
        continue;
      }
      varients.push({ name: type, type: 'array' });
    }
    return { varients: varients, discriminatorProp: undefined };
  }

  const matrix: Varient[][] = [];
  for (const objectSchema of schemasByType.object ?? []) {
    if (objectSchema.additionalProperties || isEmpty(objectSchema.properties)) {
      continue;
    }

    const list = Object.entries(objectSchema.properties).map(
      ([name, schemaOrRef]) => {
        const schema = resolveRef<SchemaObject>(spec, schemaOrRef);
        if (schema.type === 'string' && !isEmpty(schema.enum)) {
          return {
            static: true,
            source: name,
            type: 'object',
            subtype: 'string',
            name: schema.enum[0],
          } satisfies Varient;
        }
        return {
          type: 'object',
          subtype: 'string',
          source: name,
          name: name,
        } satisfies Varient;
      },
    );
    matrix.push([...new Set(list)]);
  }
  if (matrix.length === 0) {
    throw new Error(
      'No valid objects found in anyOf. Please check your OpenAPI spec.',
    );
  }

  let discriminatorProp: Varient | undefined;
  const firstRow = matrix[0];
  for (const prop of firstRow) {
    // check if this prop is exists across all rows
    const existsCrossAllRows = matrix.every((row) => row.includes(prop));
    if (existsCrossAllRows) {
      discriminatorProp = prop;
      break;
    }
  }
  for (const row of matrix) {
    for (const prop of row) {
      // check if this prop is unique across all rows
      const isUnique = matrix.every((it) =>
        it === row ? true : !it.includes(prop),
      );
      if (isUnique) {
        varients.push(prop);
        break;
      }
    }
  }

  if (varients.length !== matrix.length) {
    throw new Error(
      `Discriminator prop "${discriminatorProp}" does not cover all varients: ${varients.join(
        ', ',
      )}. Some varients might be missing.`,
    );
  }

  return { discriminatorProp, varients };
}

export function coerceTypes(schema: SchemaObject) {
  return Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
}
