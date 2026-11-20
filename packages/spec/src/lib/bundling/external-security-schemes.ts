import type { SecurityRequirementObject } from 'openapi3-ts/oas31';

import {
  type OpenAPIDocument,
  type OpenAPISecuritySchemeObject,
  followRef,
  isRef,
} from '@sdk-it/core';

import type { Documents } from '../documents/documents.js';
import { UnresolvedSecuritySchemeError } from '../documents/errors.js';
import { Reference } from '../documents/reference.js';
import { iterateOperations } from '../for-each-operation.js';
import { isJsonObject } from '../json.js';
import { availableName } from './available-name.js';

const securitySchemeTypes = [
  'apiKey',
  'http',
  'mutualTLS',
  'oauth2',
  'openIdConnect',
] as const;

/**
 * OpenAPI 3.2 lets a security requirement key be a URI of a Security Scheme
 * Object instead of a `components.securitySchemes` name. Generators key
 * credentials by scheme name, so each URI's scheme is registered under a local
 * name and the requirement rewritten to it.
 */
export class ExternalSecuritySchemes {
  readonly #spec: OpenAPIDocument;
  readonly #documents: Documents;

  constructor(spec: OpenAPIDocument, documents: Documents) {
    this.#spec = spec;
    this.#documents = documents;
  }

  /** Registers the scheme behind each URI requirement key, and returns one error for each URI that could not be read. */
  async register() {
    const requirements = this.#requirements();
    const uris = new Set(
      requirements
        .flatMap((requirement) => Object.keys(requirement))
        .filter(
          (key) =>
            !this.#spec.components?.securitySchemes?.[key] && isUriKey(key),
        ),
    );
    const failures: UnresolvedSecuritySchemeError[] = [];
    if (!uris.size) {
      return failures;
    }

    const schemes = ((this.#spec.components ??= {}).securitySchemes ??= {});
    const registered = new Map<string, string>();
    for (const uri of uris) {
      try {
        const scheme = await this.#resolve(new Reference(uri));
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

  #requirements() {
    const requirements: SecurityRequirementObject[] = [
      ...(this.#spec.security ?? []),
    ];
    for (const { operation } of iterateOperations({
      paths: this.#spec.paths ?? {},
    })) {
      requirements.push(...(operation.security ?? []));
    }
    return requirements;
  }

  async #resolve(reference: Reference): Promise<OpenAPISecuritySchemeObject> {
    const document = reference.sameDocument
      ? this.#spec
      : await this.#document(reference);
    let scheme = reference.read(document);
    if (isRef(scheme)) {
      scheme = followRef(document, scheme.$ref);
    }
    if (!isSecurityScheme(scheme)) {
      throw new Error('the target is not a Security Scheme Object');
    }
    return scheme;
  }

  #document(reference: Reference) {
    const url = reference.documentIn(this.#spec.$self);
    return url.href === this.#spec.$self
      ? this.#spec
      : this.#documents.load(url);
  }
}

/**
 * Component keys are limited to `^[a-zA-Z0-9._-]+$`, so anything else can only
 * be a URI. A bare `auth.yaml` stays a name — treating it as a document would
 * turn a typo into a file read.
 */
function isUriKey(key: string) {
  return !/^[a-zA-Z0-9._-]+$/.test(key);
}

function isSecurityScheme(
  value: unknown,
): value is OpenAPISecuritySchemeObject {
  return (
    isJsonObject(value) &&
    securitySchemeTypes.some((type) => type === value.type)
  );
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
