import { z } from 'zod';

import type { Interceptor } from './interceptors.ts';
import type { RequestConfig } from './request.ts';

export type SecurityContext = {
  scheme: string;
  scopes: readonly string[];
  roles: readonly string[];
};
export type SecurityCredentialValue =
  | string
  | true
  | {
      username: string;
      password: string;
    };
export type SecurityCredentialProvider<T extends SecurityCredentialValue> = (
  context: SecurityContext,
) => T | Promise<T>;
export type SecurityCredential<
  T extends SecurityCredentialValue = SecurityCredentialValue,
> = T | SecurityCredentialProvider<T>;

const providerSchema = <T extends SecurityCredentialValue>() =>
  z.custom<SecurityCredentialProvider<T>>(
    (value) => typeof value === 'function',
  );
export const stringCredentialSchema = z.union([
  z.string(),
  z.literal(true),
  providerSchema<string | true>(),
]);
const basicCredentialValueSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export const basicCredentialSchema = z.union([
  basicCredentialValueSchema,
  z.literal(true),
  providerSchema<{ username: string; password: string } | true>(),
]);
export const mutualTlsCredentialSchema = z.union([
  z.literal(true),
  providerSchema<true>(),
]);

export type RuntimeSecurityScheme =
  | { type: 'apiKey'; in: 'header' | 'query' | 'cookie'; name: string }
  | { type: 'http'; scheme: string }
  | { type: 'oauth2' }
  | { type: 'openIdConnect' }
  | { type: 'mutualTLS' };

/** The spec's components.securitySchemes; a requirement can name a scheme it lacks (an unresolved external one). */
export type RuntimeSecuritySchemes = {
  readonly [name: string]: RuntimeSecurityScheme | undefined;
};

export function createSecurityInterceptor(
  requirements: readonly Record<string, readonly string[]>[],
  credentials: Record<string, SecurityCredential | undefined> | undefined,
  schemes: RuntimeSecuritySchemes,
): Interceptor {
  return {
    async before(config) {
      if (requirements.length === 0) return config;
      const secured = requirements.filter(
        (requirement) => Object.keys(requirement).length > 0,
      );
      const selected = secured.find((requirement) =>
        Object.keys(requirement).every(
          (name) => credentials?.[name] !== undefined,
        ),
      );
      if (!selected) {
        if (
          requirements.some(
            (requirement) => Object.keys(requirement).length === 0,
          )
        )
          return config;
        throw new Error(
          `Missing credentials for security requirements: ${secured
            .map((requirement) => Object.keys(requirement).join(' + '))
            .join(' or ')}`,
        );
      }
      for (const [name, values] of Object.entries(selected)) {
        const scheme = schemes[name];
        if (!scheme) {
          throw new Error(`Unsupported external security scheme: ${name}`);
        }
        const configured = credentials?.[name];
        const isOAuth =
          scheme.type === 'oauth2' || scheme.type === 'openIdConnect';
        const credential =
          typeof configured === 'function'
            ? await configured({
                scheme: name,
                scopes: isOAuth ? values : [],
                roles: isOAuth ? [] : values,
              })
            : configured;
        applyCredential(config, scheme, credential);
      }
      return config;
    },
  };
}

function applyCredential(
  config: RequestConfig,
  scheme: RuntimeSecurityScheme,
  credential: SecurityCredentialValue | undefined,
) {
  if (credential === undefined) {
    throw new Error('Security credential provider returned no credential');
  }
  // true declares a transport-owned credential: the configured fetch, a host
  // proxy, or the browser's cookie jar supplies it, so nothing is set here.
  if (credential === true) return;
  if (scheme.type === 'apiKey') {
    if (typeof credential !== 'string') {
      throw new TypeError('API key credentials must be strings');
    }
    if (scheme.in === 'header') {
      if (!config.init.headers.has(scheme.name)) {
        config.init.headers.set(scheme.name, credential);
      }
    } else if (scheme.in === 'query') {
      if (!config.url.searchParams.has(scheme.name)) {
        config.url.searchParams.set(scheme.name, credential);
      }
    } else if (scheme.in === 'cookie') {
      if ('document' in globalThis) {
        throw new Error(
          `Cannot send the ${scheme.name} cookie credential: browsers forbid setting the Cookie header. Let the browser send the cookie and pass a fetch that sets credentials: 'include'.`,
        );
      }
      const cookie = `${scheme.name}=${encodeURIComponent(credential)}`;
      const existing = config.init.headers.get('Cookie');
      if (
        !existing
          ?.split(';')
          .some((part) => part.trim().startsWith(`${scheme.name}=`))
      ) {
        config.init.headers.set(
          'Cookie',
          existing ? `${existing}; ${cookie}` : cookie,
        );
      }
    } else {
      throw new TypeError(`Unsupported apiKey location: ${String(scheme.in)}`);
    }
    return;
  }
  if (scheme.type === 'mutualTLS') {
    throw new TypeError(
      'mutualTLS credentials must be true when the custom fetch owns the client certificate',
    );
  }
  if (scheme.type === 'http' && scheme.scheme.toLowerCase() === 'basic') {
    if (
      typeof credential !== 'object' ||
      !('username' in credential) ||
      !('password' in credential)
    ) {
      throw new TypeError('Basic credentials require username and password');
    }
    const bytes = new TextEncoder().encode(
      `${credential.username}:${credential.password}`,
    );
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    if (!config.init.headers.has('Authorization')) {
      config.init.headers.set('Authorization', `Basic ${btoa(binary)}`);
    }
    return;
  }
  if (typeof credential !== 'string') {
    throw new TypeError(`${scheme.type} credentials must be strings`);
  }
  const prefix =
    scheme.type === 'http' ? authorizationScheme(scheme.scheme) : 'Bearer';
  if (!config.init.headers.has('Authorization')) {
    config.init.headers.set('Authorization', `${prefix} ${credential}`);
  }
}

// OpenAPI carries the lowercase registry name, while servers routinely match the
// Authorization prefix case-sensitively (`header.startsWith('Bearer ')`).
const authorizationSchemes: Record<string, string> = {
  basic: 'Basic',
  bearer: 'Bearer',
  digest: 'Digest',
  hoba: 'HOBA',
  mutual: 'Mutual',
  negotiate: 'Negotiate',
  oauth: 'OAuth',
  'scram-sha-1': 'SCRAM-SHA-1',
  'scram-sha-256': 'SCRAM-SHA-256',
};

function authorizationScheme(scheme: string) {
  return authorizationSchemes[scheme.toLowerCase()] ?? scheme;
}
