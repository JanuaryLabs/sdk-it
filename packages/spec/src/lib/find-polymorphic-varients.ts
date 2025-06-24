import { groupBy, uniqBy } from 'lodash-es';
import type {
  ReferenceObject,
  SchemaObject,
  SchemaObjectType,
} from 'openapi3-ts/oas31';

import { camelcase, isEmpty, isRef, resolveRef } from '@sdk-it/core';

import { coerceTypes } from './tune.js';
import type { OurOpenAPIObject } from './types.js';

export type Varient = {
  name: string;
  type: string;
  position: number;
  priority?: number;
  description?: string;
  source?: string;
  static?: boolean;
  subtype?: SchemaObjectType;
};

const groupSchemasByType = (
  spec: OurOpenAPIObject,
  schemas: (SchemaObject | ReferenceObject)[],
) => {
  const groups = schemas.reduce<
    Partial<{
      [K in
        | SchemaObjectType
        | '$ref'
        | 'oneOf'
        | 'anyOf']: K extends SchemaObjectType
        ? { schema: SchemaObject; position: number }[]
        : K extends 'oneOf' | 'anyOf'
          ? { schema: (SchemaObject | ReferenceObject)[]; position: number }[]
          : { schema: ReferenceObject; position: number }[];
    }>
  >((acc, schema, index) => {
    if (isRef(schema)) {
      const referenced = resolveRef<SchemaObject>(spec, schema);
      const [type] = coerceTypes(referenced, false);
      acc[type] ??= [];
      acc[type].push({ schema: referenced, position: index });
      return acc;
    }

    if (isRef(schema.items)) {
      const referenced = resolveRef<SchemaObject>(spec, schema.items);
      acc.array ??= [];
      acc.array.push({
        schema: { ...schema, items: referenced },
        position: index,
      });
      return acc;
    }
    if (schema.oneOf) {
      acc['oneOf'] ??= [];
      acc['oneOf'].push({ schema: schema.oneOf, position: index });
      return acc;
    }
    if (schema.anyOf) {
      acc['oneOf'] ??= [];
      acc['oneOf'].push({ schema: schema.anyOf, position: index });
      return acc;
    }
    if (schema.const) {
      switch (typeof schema.const) {
        case 'string':
          acc.string ??= [];
          acc.string.push({ schema, position: index });
          return acc;
        case 'number':
          acc.number ??= [];
          acc.number.push({ schema, position: index });
          return acc;
        case 'boolean':
          acc.boolean ??= [];
          acc.boolean.push({ schema, position: index });
          return acc;
        default:
          throw new Error(
            `Unsupported const type: ${typeof schema.const} for ${schema.const}`,
          );
      }
    }

    const [type] = coerceTypes(schema, false);
    acc[type] ??= [];
    acc[type].push({ schema, position: index });
    return acc;
  }, {});

  return groups;
};

export function findVarients(
  spec: OurOpenAPIObject,
  schemas: (SchemaObject | ReferenceObject)[],
): Varient[] {
  let varients: Varient[] = [];
  const schemasByType = groupSchemasByType(spec, schemas);
  if (!isEmpty(schemasByType.string)) {
    for (const { schema, position } of schemasByType.string) {
      if (schema.const !== undefined) {
        varients.push({
          name: schema.const || 'empty',
          type: 'string',
          position,
          priority: 100 - varients.length,
        });
        continue;
      }

      if (schema.format) {
        varients.push({
          name: camelcase(schema.format),
          type: 'string',
          position,
          priority: 90 - varients.length,
        });
        continue;
      }

      // if (!isEmpty(schema.enum)) {
      //   for (const enumValue of schema.enum) {
      //     if (enumValue === '') {
      //       varients.push({
      //         name: 'empty',
      //         type: 'string',
      //         position,
      //         priority: 80 - varients.length,
      //       });
      //       continue;
      //     }
      //     varients.push({
      //       name: enumValue,
      //       type: 'string',
      //       position,
      //       priority: 80 - varients.length,
      //     });
      //   }
      //   continue;
      // }

      varients.push({ name: 'textContent', type: 'string', position });
    }
    varients = uniqBy(varients, (it) => it.name);
  }

  if (!isEmpty(schemasByType.number) || !isEmpty(schemasByType.integer)) {
    const schemas = [
      ...(schemasByType.number ?? []),
      ...(schemasByType.integer ?? []),
    ];
    for (const { schema, position } of schemas) {
      if (schema.format === 'int64') {
        varients.push({
          name: 'integer',
          type: 'number',
          position,
          priority: 90 - varients.length,
        });
        continue;
      }
      if (schema.format === 'float') {
        varients.push({
          name: 'float',
          type: 'number',
          position,
          priority: 90 - varients.length,
        });
        continue;
      }
      if (schema.format === 'double') {
        varients.push({
          name: 'double',
          type: 'number',
          position,
          priority: 90 - varients.length,
        });
        continue;
      }
      varients.push({ name: 'number', type: 'number', position });
    }
  }

  if (!isEmpty(schemasByType.array)) {
    for (const { schema, position } of schemasByType.array) {
      const items = schema.items;
      if (!items) {
        varients.push({ name: 'any', type: 'array', position });
        continue;
      }
      const [type] = coerceTypes(items as SchemaObject);
      if (type === 'string') {
        varients.push({
          name: 'textList',
          type: 'array',
          subtype: 'string',
          position,
        });
        continue;
      }
      if (type === 'number') {
        varients.push({
          name: 'numList',
          type: 'array',
          subtype: 'number',
          position,
        });
        continue;
      }
      if (type === 'integer') {
        varients.push({
          name: 'intList',
          type: 'array',
          subtype: 'integer',
          position,
        });
        continue;
      }
      if (type === 'object') {
        const subvarients = findVarients(spec, [items]);
        for (const subvarient of subvarients) {
          varients.push({
            ...subvarient,
            type: 'array',
            position,
          });
        }
        continue;
      }
      if (type === 'array') {
        const subvarients = findVarients(spec, [items]);
        for (const subvarient of subvarients) {
          varients.push({
            ...subvarient,
            name: `${subvarient.name}Matrix`,
            type: 'array',
            position,
          });
        }
        continue;
      }
      varients.push({ name: 'list', type: 'array', position });
    }
  }

  if (!isEmpty(schemasByType.$ref)) {
    const subvarients = findVarients(
      spec,
      schemasByType.$ref.map((it) => resolveRef(spec, it.schema)),
    );
    varients.push(
      ...subvarients.map((it) => ({
        ...it,
      })),
    );
  }

  if (!isEmpty(schemasByType.oneOf)) {
    for (const { schema, position } of schemasByType.oneOf) {
      const subvarients = findVarients(spec, schema);
      varients.push(
        ...subvarients.map((it) => ({
          ...it,
          position,
        })),
      );
    }
  }

  const matrix: Varient[][] = [];

  for (const { schema, position } of schemasByType.object ?? []) {
    if (
      schema.additionalProperties ||
      isEmpty({ ...schema.properties, ...schema['x-properties'] })
    ) {
      continue;
    }

    for (const key of ['properties', 'x-properties'] as const) {
      if (!schema[key]) continue;
      const list = (
        Object.entries(schema[key]) as [
          string,
          SchemaObject | ReferenceObject,
        ][]
      ).map(([name, schemaOrRef]) => {
        const schema = resolveRef<SchemaObject>(spec, schemaOrRef);
        name = schema.const ?? schema.enum?.[0] ?? name;
        if (schema.type === 'string') {
          return {
            priority:
              schema.const !== undefined || schema.enum?.[0] !== undefined
                ? 100 - matrix.length
                : undefined,
            static: true,
            subtype: 'string',
            source: name,
            name: name,
            type: 'object',
            position,
          } satisfies Varient;
        }
        return {
          subtype: 'string',
          source: name,
          name: name,
          type: 'object',
          position,
        } satisfies Varient;
      });
      matrix.push([...new Set(list)].sort((a) => (a.static ? -1 : 1)));
    }
    if (matrix.length === 0) {
      throw new Error(
        'No valid objects found. Please check your OpenAPI spec.',
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
  }

  for (const row of matrix) {
    for (const prop of row) {
      // check if this prop is unique across all rows
      const isUnique = matrix.every((it) =>
        it === row ? true : !it.some((p) => p.name === prop.name),
      );
      if (isUnique) {
        varients.push(prop);
        break;
      }
    }
  }

  // Sort all variants by priority (highest first), then by original position
  return varients.sort((a, b) => {
    const aHasPriority = a.priority !== undefined;
    const bHasPriority = b.priority !== undefined;

    if (aHasPriority && bHasPriority) {
      // Both have priority
      if (a.priority !== b.priority) {
        return b.priority! - a.priority!; // Higher priority first
      }
      // Priorities are equal, sort by original position as a tie-breaker
      return a.position - b.position;
    } else if (aHasPriority) {
      return -1; // 'a' comes first
    } else if (bHasPriority) {
      return 1; // 'b' comes first
    } else {
      // Neither has priority. Keep their relative order from before this sort.
      // This relies on a stable sort (standard in ES2019+).
      // Returning 0 preserves the order in which they were added to the 'varients' array.
      return 0;
    }
  });
}

export function findPolymorphicVarients(
  spec: OurOpenAPIObject,
  schemas: (SchemaObject | ReferenceObject)[],
): Varient[] {
  const varients = findVarients(spec, schemas);
  // prepend '-' to prevent key sortings
  return Object.values(groupBy(varients, (it) => '-' + it.position)).map(
    (group) => {
      return (group ?? [])[0];
    },
  );
}
