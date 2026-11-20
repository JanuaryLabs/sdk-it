import { ExternalSecuritySchemes } from '../bundling/external-security-schemes.js';
import { Documents } from '../documents/documents.js';
import type { DocumentPlugin } from '../processing.js';

/**
 * Registers the Security Scheme Object behind each OpenAPI 3.2 security
 * requirement URI under a local name, and reports each URI that could not be
 * read.
 */
export function resolveSecuritySchemeUris(): DocumentPlugin {
  return {
    name: 'resolve-security-scheme-uris',
    async process({ spec, report }) {
      const failures = await new ExternalSecuritySchemes(
        spec,
        Documents.standard([]),
      ).register();
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
