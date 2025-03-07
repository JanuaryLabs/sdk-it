import type {
  ComponentsObject,
  ReferenceObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { type Options } from './sdk.ts';

export function isRef(obj: any): obj is ReferenceObject {
  return '$ref' in obj;
}
export function securityToOptions(
  security: SecurityRequirementObject[],
  securitySchemas: ComponentsObject['securitySchemes'],
  staticIn?: string,
) {
  securitySchemas ??= {};
  const options: Options = {};
  for (const it of security) {
    const [name] = Object.keys(it);
    const schema = securitySchemas[name];
    if (isRef(schema)) {
      throw new Error(`Ref security schemas are not supported`);
    }
    if (schema.type === 'http') {
      options['authorization'] = {
        in: staticIn ?? 'header',
        schema: 'z.string().optional()',
        optionName: 'token',
      };
      continue;
    }
    if (schema.type === 'apiKey') {
      if (!schema.in) {
        throw new Error(`apiKey security schema must have an "in" field`);
      }
      if (!schema.name) {
        throw new Error(`apiKey security schema must have a "name" field`);
      }
      options[schema.name] = {
        in: staticIn ?? schema.in,
        schema: 'z.string().optional()',
      };
      continue;
    }
  }
  return options;
}
