import type { OpenAPISecuritySchemeObject } from '@sdk-it/core';

import { iterateOperations } from '../for-each-operation.js';
import type { ProcessingPlugin } from '../processing.js';

export function normalizeSecurity(): ProcessingPlugin {
  return {
    name: 'normalize-security',
    process({ spec, report }) {
      for (const [name, scheme] of Object.entries(
        spec.components.securitySchemes,
      )) {
        const message = invalidSecurityScheme(scheme);
        if (message) {
          report({
            code: 'invalid-security-scheme',
            severity: 'error',
            path: `components.securitySchemes.${name}`,
            message,
          });
        }
      }
      for (const { entry, operation } of iterateOperations(spec)) {
        operation.security = structuredClone(
          operation.security ?? spec.security ?? [],
        );
        const path = `${entry.method.toUpperCase()} ${entry.path}`;
        for (const requirement of operation.security) {
          const targets = new Map<string, string>();
          for (const [name, values] of Object.entries(requirement)) {
            const scheme = spec.components.securitySchemes[name];
            if (!scheme) {
              // OpenAPI 3.2 allows external URI references here, but no
              // generator can emit a credential for one.
              report({
                code: 'unresolved-security-scheme',
                severity: 'error',
                path,
                message: `Security scheme ${name} must be resolved in components.securitySchemes`,
              });
              continue;
            }
            if (scheme.type === 'oauth2') {
              const availableScopes = new Set(
                Object.values(scheme.flows ?? {}).flatMap((flow) =>
                  Object.keys(flow?.scopes ?? {}),
                ),
              );
              for (const scope of values) {
                if (!availableScopes.has(scope)) {
                  report({
                    code: 'unknown-oauth-scope',
                    severity: 'error',
                    path,
                    message: `OAuth2 scheme ${name} does not declare scope ${scope}`,
                  });
                }
              }
            }
            const target = credentialTarget(scheme);
            const existing = target ? targets.get(target) : undefined;
            if (target && existing) {
              report({
                code: 'conflicting-security-target',
                severity: 'error',
                path,
                message: `Security schemes ${existing} and ${name} both use ${target}`,
              });
            } else if (target) {
              targets.set(target, name);
            }
          }
        }
      }
    },
  };
}

function invalidSecurityScheme(
  scheme: OpenAPISecuritySchemeObject,
): string | undefined {
  const value = scheme as OpenAPISecuritySchemeObject & Record<string, unknown>;
  switch (value.type as string) {
    case 'apiKey':
      if (typeof value.name !== 'string' || value.name.length === 0) {
        return 'apiKey security schemes require a name';
      }
      if (!['header', 'query', 'cookie'].includes(value.in as string)) {
        return 'apiKey security schemes require header, query, or cookie in';
      }
      return undefined;
    case 'http':
      return typeof value.scheme === 'string' && value.scheme.length > 0
        ? undefined
        : 'HTTP security schemes require a scheme';
    case 'mutualTLS':
      return undefined;
    case 'openIdConnect':
      return typeof value.openIdConnectUrl === 'string' &&
        value.openIdConnectUrl.length > 0
        ? undefined
        : 'OpenID Connect security schemes require openIdConnectUrl';
    case 'oauth2': {
      if (!value.flows || typeof value.flows !== 'object') {
        return 'OAuth2 security schemes require flows';
      }
      const flows = value.flows as Record<
        string,
        Record<string, unknown> | undefined
      >;
      const requiredUrls: Record<string, string[]> = {
        implicit: ['authorizationUrl'],
        password: ['tokenUrl'],
        clientCredentials: ['tokenUrl'],
        authorizationCode: ['authorizationUrl', 'tokenUrl'],
        deviceAuthorization: ['deviceAuthorizationUrl', 'tokenUrl'],
      };
      const configured = Object.entries(requiredUrls).filter(
        ([flow]) => flows[flow] !== undefined,
      );
      if (configured.length === 0) {
        return 'OAuth2 security schemes require at least one flow';
      }
      for (const [flowName, fields] of configured) {
        const flow = flows[flowName]!;
        if (!flow.scopes || typeof flow.scopes !== 'object') {
          return `OAuth2 ${flowName} flow requires scopes`;
        }
        for (const field of fields) {
          if (typeof flow[field] !== 'string' || flow[field].length === 0) {
            return `OAuth2 ${flowName} flow requires ${field}`;
          }
        }
      }
      return undefined;
    }
    default:
      return `Unsupported security scheme type ${String(value.type)}`;
  }
}

function credentialTarget(
  scheme: OpenAPISecuritySchemeObject,
): string | undefined {
  switch (scheme.type) {
    case 'apiKey': {
      if (!scheme.in || !scheme.name) return undefined;
      const name =
        scheme.in === 'header' ? scheme.name.toLowerCase() : scheme.name;
      return `${scheme.in}:${name}`;
    }
    case 'http':
    case 'oauth2':
    case 'openIdConnect':
      return 'header:authorization';
    case 'mutualTLS':
      return 'transport:client-certificate';
  }
}
