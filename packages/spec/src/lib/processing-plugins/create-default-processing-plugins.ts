import type { ProcessingPlugin } from '../processing.js';
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
import { normalizeTags } from './normalize-tags.js';

export function createDefaultProcessingPlugins(
  options: { verbose?: boolean } = {},
): ProcessingPlugin[] {
  return [
    normalizePaths(),
    normalizeOperationIds(),
    normalizeTags(),
    normalizeParameters(),
    normalizeResponses(),
    normalizeRequestBodies(),
    inferPagination(),
    normalizeSchemas(),
    ...(options.verbose ? [extractInlineSchemas()] : []),
    extractOverviewDocsPlugin(),
    canonicalizeSpec(),
  ];
}
