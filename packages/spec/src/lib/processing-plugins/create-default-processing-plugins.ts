import type { DocumentPlugin, IRPlugin } from '../processing.js';
import { bundleExternalRefs } from './bundle-external-refs.js';
import { canonicalizeSpec } from './canonicalize-spec.js';
import { extractInlineSchemas } from './extract-inline-schemas.js';
import { extractOverviewDocsPlugin } from './extract-overview-docs.js';
import { inferPagination } from './infer-pagination.js';
import { normalizeOperationIds } from './normalize-operation-ids.js';
import { normalizeParameters } from './normalize-parameters.js';
import { normalizePaths } from './normalize-paths.js';
import { normalizeRequestBodies } from './normalize-request-bodies.js';
import { normalizeResponses } from './normalize-responses.js';
import { normalizeSchemas } from './normalize-schemas.js';
import { normalizeSecurity } from './normalize-security.js';
import { normalizeTags } from './normalize-tags.js';
import { resolveSecuritySchemeUris } from './resolve-security-scheme-uris.js';

export function createDefaultDocumentPlugins(): DocumentPlugin[] {
  return [
    bundleExternalRefs(),
    normalizePaths(),
    normalizeOperationIds(),
    normalizeTags(),
    normalizeParameters(),
    normalizeResponses(),
    resolveSecuritySchemeUris(),
    normalizeSecurity(),
    normalizeRequestBodies(),
  ];
}

export function createDefaultIRPlugins(
  options: { verbose?: boolean } = {},
): IRPlugin[] {
  return [
    inferPagination(),
    normalizeSchemas(),
    ...(options.verbose ? [extractInlineSchemas()] : []),
    extractOverviewDocsPlugin(),
    canonicalizeSpec(),
  ];
}
