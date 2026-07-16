import { extractOverviewDocs } from '../overview-docs/overview-docs.js';
import type { ProcessingPlugin } from '../processing.js';

export function extractOverviewDocsPlugin(): ProcessingPlugin {
  return {
    name: 'extract-overview-docs',
    process({ spec }) {
      spec['x-docs'] = extractOverviewDocs(spec);
    },
  };
}
