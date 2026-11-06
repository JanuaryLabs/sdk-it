import { camelcase } from 'stringcase';

import {
  type References,
  type RuntimeName,
  fileReferences,
} from './references.ts';
import type { Spec } from './sdk.ts';
import { securityTypeExports } from './security.ts';

type SecurityScheme = Spec['securitySchemes'][string];
type ClientSpec = Omit<Spec, 'operations' | 'makeImport'>;

function credentialSchemaName(scheme: SecurityScheme): RuntimeName {
  if (scheme.type === 'mutualTLS') {
    return 'mutualTlsCredentialSchema';
  }
  if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic') {
    return 'basicCredentialSchema';
  }
  return 'stringCredentialSchema';
}

function credentialSchemas(spec: ClientSpec) {
  return Object.entries(spec.securitySchemes).map(
    ([scheme, definition]) =>
      [scheme, credentialSchemaName(definition)] as const,
  );
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

/** Every name `clientDeclarations` can declare for a client named `name`. */
export function clientDeclaredNames(name: string) {
  return [
    ...clientExports(name),
    `create${name}`,
    camelcase(name),
    'servers',
    '__securitySchemes',
    '__credentialsSchema',
    '__api',
  ];
}

/** The runtime functions the SDK root exports from the client module. */
export const clientRuntimeExports = ['prepare', 'request'];

/** The runtime types the SDK root exports when the spec names security schemes. */
export function clientRuntimeTypeExports(spec: ClientSpec) {
  return credentialSchemas(spec).length > 0 ? securityTypeExports : [];
}

/**
 * The spec-specific part of a generated SDK's client: its servers and security
 * as an `api` over the endpoint table `routes`, a `create<Name>(settings)`
 * factory over @sdk-it/runtime's Client, and a default instance when the spec
 * names at most one server.
 */
export function clientDeclarations(
  spec: ClientSpec,
  refs: References,
  routes: string,
) {
  const { name } = spec;
  const credentials = credentialSchemas(spec);
  return `${spec.servers.length ? 'export ' : ''}const servers = ${JSON.stringify(spec.servers, null, 2)} as const;
${spec.servers.length ? `export type ${name}Servers = (typeof servers)[number];` : ''}
const __securitySchemes = ${JSON.stringify(spec.securitySchemes, null, 2)} as const;
const __credentialsSchema = z.object({
${credentials.map(([scheme, schema]) => `  ${JSON.stringify(scheme)}: ${refs.runtime(schema)}.optional(),`).join('\n')}
});
const __api = { routes: ${routes}, servers, securitySchemes: __securitySchemes, credentials: __credentialsSchema };

export interface ${name}Client extends ${refs.runtime('Client')}<typeof __api> {}
export type ${name}Settings = ${refs.runtime('ClientSettings')}<typeof __api>;
export type ${name}Endpoints = ${refs.runtime('EndpointsOf')}<typeof __api>;
${credentials.length ? `export type ${name}Credentials = z.input<typeof __credentialsSchema>;` : ''}

export function ${refs.located(`create${name}`, title)}(settings: ${name}Settings): ${name}Client {
  return ${refs.runtime('createClient')}(__api, settings);
}
${spec.servers.length <= 1 ? `\nexport const ${refs.located(camelcase(name), title)} = create${name}({});\n` : ''}`;
}

/** The provider exports name the API the document describes. */
const title = ['info', 'title'];

/** client.ts imports the client types and factory under `__` aliases. */
const aliased = new Set<RuntimeName>([
  'Client',
  'ClientSettings',
  'EndpointsOf',
  'createClient',
]);
const clientFileReferences: References = {
  ...fileReferences('outputs'),
  runtime: (name) => (aliased.has(name) ? `__${name}` : name),
};

/** The client.ts file of a multi-file SDK. */
export default (spec: Omit<Spec, 'operations'>) => {
  const { makeImport } = spec;
  const typeExports = clientRuntimeTypeExports(spec);
  const credentialImports = [
    ...new Set(credentialSchemas(spec).map(([, schema]) => schema)),
  ].sort();

  return `import { z } from 'zod';
import __schemas from './api/${makeImport('schemas')}';
import { type Client as __Client, type ClientSettings as __ClientSettings, type EndpointsOf as __EndpointsOf, createClient as __createClient } from './http/${makeImport('client')}';${
    typeExports.length
      ? `
import { ${credentialImports.join(', ')} } from './http/${makeImport('security')}';
export type {
${typeExports.map((type) => `  ${type},`).join('\n')}
} from './http/${makeImport('security')}';`
      : ''
  }
export { ${clientRuntimeExports.join(', ')} } from './http/${makeImport('client')}';

${clientDeclarations(spec, clientFileReferences, '__schemas')}`;
};
