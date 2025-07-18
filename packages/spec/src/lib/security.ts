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
  const parameters: OurParameter[] = [];
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
      parameters.push({
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
      parameters.push({
        in: staticIn ?? (schema.in as ParameterLocation),
        name: schema.name,
        required: false,
        schema: { type: 'string' },
        example: `"proj-${crypto.randomUUID().slice(0, 12)}"`,
      });
      continue;
    }
  }
  return parameters;
}

export function security(spec: IR) {
  const security = spec.security || [];
  const paths = Object.values(spec.paths ?? {});

  const options = securityToOptions(
    spec,
    security,
    spec.components.securitySchemes,
  );

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
          spec.components.securitySchemes,
          'input',
        ),
      );
    }
  }
  return options;
}
