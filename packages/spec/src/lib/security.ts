import type {
  ParameterLocation,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
  SecurityRequirementObject,
  SecuritySchemeObject,
} from 'openapi3-ts/oas31';

import { methods } from '@sdk-it/core/paths.js';
import { resolveRef } from '@sdk-it/core/ref.js';

import type { IR } from './types.js';

type OIn = ParameterLocation | 'input';

export type OurParameter = Omit<ParameterObject, 'in' | 'schema'> & {
  in: OIn;
  'x-optionName'?: string;
  schema: SchemaObject;
};

export function securityToOptions(
  spec: IR,
  security: SecurityRequirementObject[],
  securitySchemes: Record<string, SecuritySchemeObject | ReferenceObject>,
  staticIn?: OIn,
) {
  // Distinct schemes can resolve to the same parameter (e.g. Figma's
  // PersonalAccessToken and PlanAccessToken both use the X-Figma-Token
  // header), so key by location + name to avoid duplicate options.
  const parameters = new Map<string, OurParameter>();
  for (const it of security) {
    const [name] = Object.keys(it);
    if (!name) {
      // this means the operation doesn't necessarily require security
      continue;
    }

    const schema = resolveRef<SecuritySchemeObject>(
      spec,
      securitySchemes[name],
    );
    if (schema.type === 'http') {
      parameters.set(`${staticIn ?? 'header'}:authorization`, {
        in: staticIn ?? 'header',
        name: 'authorization',
        required: false,
        schema: { type: 'string', 'x-prefix': 'Bearer ' },
        'x-optionName': 'token',
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
      const paramIn = staticIn ?? (schema.in as ParameterLocation);
      parameters.set(`${paramIn}:${schema.name}`, {
        in: paramIn,
        name: schema.name,
        required: false,
        schema: { type: 'string' },
        example: `"proj-${crypto.randomUUID().slice(0, 12)}"`,
      });
      continue;
    }
  }
  return [...parameters.values()];
}

export function security(spec: IR) {
  const security = spec.security || [];
  const paths = Object.values(spec.paths ?? {});

  // Same keying as securityToOptions: two parameters may share a name but
  // differ in location (e.g. header vs query api keys), so name alone drops
  // credentials.
  const options = new Map<string, OurParameter>();
  for (const option of securityToOptions(
    spec,
    security,
    spec.components.securitySchemes,
  )) {
    options.set(`${option.in}:${option.name}`, option);
  }

  for (const it of paths) {
    for (const method of methods) {
      const operation = it[method];
      if (!operation) {
        continue;
      }
      for (const option of securityToOptions(
        spec,
        operation.security || [],
        spec.components.securitySchemes,
        'input',
      )) {
        options.set(`${option.in}:${option.name}`, option);
      }
    }
  }
  return [...options.values()];
}
