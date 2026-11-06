import { camelcase } from 'stringcase';

import type { Spec } from './sdk.ts';
import { securityTypeExports } from './security.ts';

type SecurityScheme = Spec['securitySchemes'][string];

function credentialSchemaName(scheme: SecurityScheme) {
  if (scheme.type === 'mutualTLS') {
    return 'mutualTlsCredentialSchema';
  }
  if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic') {
    return 'basicCredentialSchema';
  }
  return 'stringCredentialSchema';
}

/** Names the generated client module exports at the SDK root besides its models. */
export function clientExports(name: string) {
  return [
    `${name}Client`,
    `${name}Credentials`,
    `${name}Endpoints`,
    `${name}Servers`,
    `${name}Settings`,
  ];
}

/**
 * The spec-specific part of a generated SDK's client: its endpoint table,
 * servers and security as an `api`, a `create<Name>(settings)` factory over
 * @sdk-it/runtime's Client, and a default instance when the spec names at most
 * one server.
 */
export default (spec: Omit<Spec, 'operations'>) => {
  const { name, makeImport } = spec;
  const credentialSchemas = Object.entries(spec.securitySchemes).map(
    ([scheme, definition]) =>
      [scheme, credentialSchemaName(definition)] as const,
  );
  const secured = credentialSchemas.length > 0;
  const credentialImports = [
    ...new Set(credentialSchemas.map(([, schema]) => schema)),
  ].sort();

  return `import { z } from 'zod';
import __schemas from './api/${makeImport('schemas')}';
import { type Client as __Client, type ClientSettings as __ClientSettings, type EndpointsOf as __EndpointsOf, createClient as __createClient } from './http/${makeImport('client')}';${
    secured
      ? `
import { ${credentialImports.join(', ')} } from './http/${makeImport('security')}';
export type {
${securityTypeExports.map((type) => `  ${type},`).join('\n')}
} from './http/${makeImport('security')}';`
      : ''
  }
export { prepare, request } from './http/${makeImport('client')}';

${spec.servers.length ? 'export ' : ''}const servers = ${JSON.stringify(spec.servers, null, 2)} as const;
${spec.servers.length ? `export type ${name}Servers = (typeof servers)[number];` : ''}
const __securitySchemes = ${JSON.stringify(spec.securitySchemes, null, 2)} as const;
const __credentialsSchema = z.object({
${credentialSchemas.map(([scheme, schema]) => `  ${JSON.stringify(scheme)}: ${schema}.optional(),`).join('\n')}
});
const __api = { routes: __schemas, servers, securitySchemes: __securitySchemes, credentials: __credentialsSchema };

export interface ${name}Client extends __Client<typeof __api> {}
export type ${name}Settings = __ClientSettings<typeof __api>;
export type ${name}Endpoints = __EndpointsOf<typeof __api>;
${secured ? `export type ${name}Credentials = z.input<typeof __credentialsSchema>;` : ''}

export function create${name}(settings: ${name}Settings): ${name}Client {
  return __createClient(__api, settings);
}
${spec.servers.length <= 1 ? `\nexport const ${camelcase(name)} = create${name}({});\n` : ''}`;
};
