import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { isEmpty, isRef, parseRef, pascalcase } from '@sdk-it/core';

import type { OurOpenAPIObject } from './types.ts';

export function getRefUsage(
  spec: OurOpenAPIObject,
  schemaName: string,
  list: string[] = [],
): string[] {
  const checkSchema = (
    schema: SchemaObject | ReferenceObject,
    withRefCheck = false,
  ): any => {
    if (isRef(schema)) {
      if (!withRefCheck) return false;
      const { model } = parseRef(schema.$ref);
      return model === schemaName;
    }
    if (!isEmpty(schema.oneOf)) {
      return schema.oneOf.some((it) => checkSchema(it, true));
    }
    if (schema.type === 'array' && schema.items) {
      if (isRef(schema.items)) {
        return checkSchema(schema.items, withRefCheck);
      }
      if (schema.items.oneOf) {
        return schema.items.oneOf.some((it) => checkSchema(it, true));
      }
      return checkSchema(schema.items, withRefCheck);
    }

    if (schema.type === 'object') {
      const properties = schema.properties;
      if (!isEmpty(properties)) {
        let found = false;
        let propertyName = '';
        for (const [key, it] of Object.entries(properties)) {
          found = checkSchema(it, false);
          if (found) {
            propertyName = key;
          }
        }
        return propertyName;
      }
    }
    return false;
  };

  for (const [key, value] of Object.entries(spec.components.schemas)) {
    const thisWouldBeTheObjectPropertyKeyName = checkSchema(value);
    if (thisWouldBeTheObjectPropertyKeyName) {
      if (typeof thisWouldBeTheObjectPropertyKeyName === 'string') {
        list.push(pascalcase(`${key} ${thisWouldBeTheObjectPropertyKeyName}`));
      } else {
        list.push(pascalcase(key));
      }
    }
  }

  return list;
}
