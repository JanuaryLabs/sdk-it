import type {
  ComponentsObject,
  OpenAPIObject,
  ParameterLocation,
  ParameterObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { methods } from '@sdk-it/core/paths.js';
import { followRef, isRef } from '@sdk-it/core/ref.js';

type OIn = ParameterLocation | 'input';
type OParameter = Omit<ParameterObject, 'in'> & {
  in: OIn;
};

export function securityToOptions(
  spec: OpenAPIObject,
  security: SecurityRequirementObject[],
  securitySchemes: ComponentsObject['securitySchemes'],
  staticIn?: OIn,
) {
  securitySchemes ??= {};
  const parameters: OParameter[] = [];
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
        example:
          schema.scheme === 'bearer'
            ? '"<token>"'
            : `<${schema.scheme}> <token>`,
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
        example: `"proj-${crypto.randomUUID()}"`,
      });
      continue;
    }
  }
  return parameters;
}

export function security(spec: OpenAPIObject) {
  const security = spec.security || [];
  const components = spec.components || {};
  const securitySchemes = components.securitySchemes || {};
  const paths = Object.values(spec.paths ?? {});

  const options = securityToOptions(spec, security, securitySchemes);

  for (const it of paths) {
    for (const method of methods) {
      const operation = it[method];
      if (!operation) {
        continue;
      }
      Object.assign(
        options,
        securityToOptions(
          spec,
          operation.security || [],
          securitySchemes,
          'input',
        ),
      );
    }
  }
  return options;
}
