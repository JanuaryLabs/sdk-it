import { fileURLToPath } from 'node:url';
import type { SecurityRequirementObject } from 'openapi3-ts/oas31';

import {
  type OpenAPISecuritySchemeObject,
  followRef,
  isRef,
} from '@sdk-it/core';

import { iterateOperations } from '../for-each-operation.js';
import { loadFile } from '../loaders/load-spec.js';
import type { ProcessingPlugin } from '../processing.js';
import type { IR } from '../types.js';

/**
 * OpenAPI 3.2 lets a security requirement key be a URI of a Security Scheme
 * Object instead of a `components.securitySchemes` name. Generators key
 * credentials by scheme name, so each URI is fetched, registered locally, and
 * the requirement rewritten to point at the registered name.
 */
export function resolveSecuritySchemeUris(): ProcessingPlugin {
  return {
    name: 'resolve-security-scheme-uris',
    async process({ spec, report }) {
      const requirements = collectRequirements(spec);
      const uris = new Set(
        requirements
          .flatMap((requirement) => Object.keys(requirement))
          .filter(
            (key) => !spec.components.securitySchemes[key] && isUriKey(key),
          ),
      );
      if (!uris.size) {
        return;
      }

      const documents = new Map<string, Promise<unknown>>();
      const registered = new Map<string, string>();
      for (const uri of uris) {
        try {
          const scheme = await resolveScheme(uri, spec, documents);
          // A same-document pointer lands on an already registered object;
          // reuse its name instead of registering a second copy.
          const [alias] =
            Object.entries(spec.components.securitySchemes).find(
              ([, registeredScheme]) => registeredScheme === scheme,
            ) ?? [];
          const name = alias ?? availableName(spec, schemeName(uri));
          spec.components.securitySchemes[name] = scheme;
          registered.set(uri, name);
        } catch (error) {
          report({
            code: 'unresolvable-security-scheme-uri',
            severity: 'error',
            path: uri,
            message: `Could not resolve security scheme URI ${uri}: ${error instanceof Error ? error.message : String(error)}`,
          });
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
    },
  };
}

function collectRequirements(spec: IR) {
  const requirements: SecurityRequirementObject[] = [...(spec.security ?? [])];
  for (const { operation } of iterateOperations(spec)) {
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
  spec: IR,
  documents: Map<string, Promise<unknown>>,
): Promise<OpenAPISecuritySchemeObject> {
  const [location, fragment] = splitFragment(uri);
  const document = location
    ? await loadDocument(location, spec, documents)
    : spec;
  let scheme = fragment ? readPointer(document, fragment) : document;
  if (isRef(scheme)) {
    scheme = followRef(document as never, scheme.$ref);
  }
  if (
    scheme === null ||
    typeof scheme !== 'object' ||
    typeof (scheme as { type?: unknown }).type !== 'string'
  ) {
    return Promise.reject(
      new Error('the target is not a Security Scheme Object'),
    );
  }
  return scheme as OpenAPISecuritySchemeObject;
}

function loadDocument(
  location: string,
  spec: IR,
  documents: Map<string, Promise<unknown>>,
) {
  const base = spec.$self;
  if (!base && !isAbsolute(location)) {
    return Promise.reject(
      new Error(
        'the document declares no $self, so a relative URI has no base to resolve against',
      ),
    );
  }
  const url = new URL(location, base);
  if (url.href === base) {
    return Promise.resolve(spec);
  }
  let pending = documents.get(url.href);
  if (!pending) {
    pending = loadFile(
      url.protocol === 'file:' ? fileURLToPath(url) : url.href,
    );
    documents.set(url.href, pending);
  }
  return pending;
}

function isAbsolute(location: string) {
  return URL.canParse(location);
}

function splitFragment(uri: string): [string, string | undefined] {
  const index = uri.indexOf('#');
  return index === -1
    ? [uri, undefined]
    : [uri.slice(0, index), uri.slice(index + 1)];
}

function readPointer(document: unknown, fragment: string) {
  let current: unknown = document;
  for (const segment of fragment.split('/')) {
    if (!segment) {
      continue;
    }
    const key = decodeURIComponent(segment)
      .replaceAll('~1', '/')
      .replaceAll('~0', '~');
    if (
      current === null ||
      typeof current !== 'object' ||
      !(key in (current as object))
    ) {
      throw new Error(`no value at pointer #${fragment}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function schemeName(uri: string) {
  const [location, fragment] = splitFragment(uri);
  const candidate =
    lastSegment(fragment ?? '') ??
    lastSegment(location.split('?')[0])?.replace(/\.(json|ya?ml)$/i, '');
  const sanitized = (candidate ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
  return sanitized || 'externalSecurityScheme';
}

function lastSegment(value: string) {
  return value.split('/').filter(Boolean).at(-1);
}

function availableName(spec: IR, candidate: string) {
  let name = candidate;
  let suffix = 2;
  while (spec.components.securitySchemes[name]) {
    name = `${candidate}${suffix++}`;
  }
  return name;
}
