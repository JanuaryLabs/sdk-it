import type { SecurityRequirementObject } from 'openapi3-ts/oas31';

import {
  type OpenAPIDocument,
  type OpenAPISecuritySchemeObject,
  followRef,
  isRef,
} from '@sdk-it/core';

import { availableName } from '../bundling/available-name.js';
import { Documents } from '../documents/documents.js';
import { UnresolvedSecuritySchemeError } from '../documents/errors.js';
import { Reference } from '../documents/reference.js';
import { iterateOperations } from '../for-each-operation.js';
import { isJsonObject } from '../json.js';
import type { DocumentPlugin } from '../processing.js';

/**
 * OpenAPI 3.2 lets a security requirement key be a URI of a Security Scheme
 * Object instead of a `components.securitySchemes` name. Generators key
 * credentials by scheme name, so each URI is fetched, registered locally, and
 * the requirement rewritten to point at the registered name.
 */
export function resolveSecuritySchemeUris(): DocumentPlugin {
  return {
    name: 'resolve-security-scheme-uris',
    async process({ spec, report }) {
      const failures = await registerExternalSecuritySchemes(
        spec,
        Documents.standard(),
      );
      for (const failure of failures) {
        report({
          code: 'unresolvable-security-scheme-uri',
          severity: 'error',
          path: failure.uri,
          message: failure.message,
        });
      }
    },
  };
}

/**
 * Registers the scheme behind each URI requirement key under a local name and
 * rewrites the requirement to it. Every document read is recorded in
 * `documents`; the URIs that could not be resolved are returned.
 */
export async function registerExternalSecuritySchemes(
  spec: OpenAPIDocument,
  documents: Documents,
) {
  const requirements = collectRequirements(spec);
  const uris = new Set(
    requirements
      .flatMap((requirement) => Object.keys(requirement))
      .filter(
        (key) => !spec.components?.securitySchemes?.[key] && isUriKey(key),
      ),
  );
  const failures: UnresolvedSecuritySchemeError[] = [];
  if (!uris.size) {
    return failures;
  }

  const schemes = ((spec.components ??= {}).securitySchemes ??= {});
  const registered = new Map<string, string>();
  for (const uri of uris) {
    try {
      const scheme = await resolveScheme(uri, spec, documents);
      // A same-document pointer lands on an already registered object;
      // reuse its name instead of registering a second copy.
      const [alias] =
        Object.entries(schemes).find(
          ([, registeredScheme]) => registeredScheme === scheme,
        ) ?? [];
      const name = alias ?? availableName(schemes, schemeName(uri));
      schemes[name] = scheme;
      registered.set(uri, name);
    } catch (error) {
      failures.push(new UnresolvedSecuritySchemeError(uri, { cause: error }));
    }
  }

  for (const requirement of requirements) {
    for (const [uri, name] of registered) {
      if (Object.hasOwn(requirement, uri)) {
        requirement[name] = requirement[uri];
        delete requirement[uri];
      }
    }
  }
  return failures;
}

function collectRequirements(spec: OpenAPIDocument) {
  const requirements: SecurityRequirementObject[] = [...(spec.security ?? [])];
  for (const { operation } of iterateOperations({ paths: spec.paths ?? {} })) {
    requirements.push(...(operation.security ?? []));
  }
  return requirements;
}

/**
 * Component keys are limited to `^[a-zA-Z0-9._-]+$`, so anything else can only
 * be a URI. A bare `auth.yaml` stays a name — treating it as a document would
 * turn a typo into a file read.
 */
function isUriKey(key: string) {
  return !/^[a-zA-Z0-9._-]+$/.test(key);
}

async function resolveScheme(
  uri: string,
  spec: OpenAPIDocument,
  documents: Documents,
): Promise<OpenAPISecuritySchemeObject> {
  const reference = new Reference(uri);
  const document = reference.sameDocument
    ? spec
    : await schemeDocument(reference, spec, documents);
  let scheme = reference.read(document);
  if (isRef(scheme)) {
    scheme = followRef(document, scheme.$ref);
  }
  if (!isSecurityScheme(scheme)) {
    return Promise.reject(
      new Error('the target is not a Security Scheme Object'),
    );
  }
  return scheme;
}

const securitySchemeTypes = [
  'apiKey',
  'http',
  'mutualTLS',
  'oauth2',
  'openIdConnect',
] as const;

function isSecurityScheme(
  value: unknown,
): value is OpenAPISecuritySchemeObject {
  return (
    isJsonObject(value) &&
    securitySchemeTypes.some((type) => type === value.type)
  );
}

function schemeDocument(
  reference: Reference,
  spec: OpenAPIDocument,
  documents: Documents,
) {
  const url = reference.documentIn(spec.$self);
  return url.href === spec.$self ? spec : documents.load(url);
}

function schemeName(uri: string) {
  const reference = new Reference(uri);
  const candidate =
    lastSegment(reference.fragment) ??
    lastSegment(reference.location.split('?')[0])?.replace(
      /\.(json|ya?ml)$/i,
      '',
    );
  const sanitized = (candidate ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
  return sanitized || 'externalSecurityScheme';
}

function lastSegment(value: string) {
  return value.split('/').filter(Boolean).at(-1);
}
