import type {
  ComponentsObject,
  OpenAPIObject,
  ParameterLocation,
  ParameterObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core';

export function securityToOptions(
  spec: OpenAPIObject,
  security: SecurityRequirementObject[],
  securitySchemes: ComponentsObject['securitySchemes'],
  staticIn?: ParameterLocation,
) {
  securitySchemes ??= {};
  const parameters: ParameterObject[] = [];
  for (const it of security) {
    const [name] = Object.keys(it);
    if (!name) {
      // this means the operation doesn't necessarily require security
      continue;
    }
    const schema = isRef(securitySchemes[name])
      ? followRef(spec, securitySchemes[name].$ref)
      : securitySchemes[name];

    if (schema.type === 'http') {
      parameters.push({
        in: staticIn ?? 'header',
        name: 'authorization',
        schema: { type: 'string' },
      });
      continue;
    }
    if (schema.type === 'apiKey') {
      if (!schema.in) {
        throw new Error(`apiKey security schema must have an "in" field`);
      }
      if (!schema.name) {
        throw new Error(`apiKey security schema must have a "name" field`);
      }
      parameters.push({
        in: staticIn ?? (schema.in as ParameterLocation),
        name: schema.name,
        schema: { type: 'string' },
      });
      continue;
    }
  }
  return parameters;
}
