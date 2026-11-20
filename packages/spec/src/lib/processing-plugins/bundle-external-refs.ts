import { ExternalRefBundler } from '../bundling/external-ref-bundler.js';
import { Documents } from '../documents/documents.js';
import type { DocumentPlugin } from '../processing.js';

/**
 * The IR holds only local `#/…` references; every later plugin relies on it.
 * External references are brought in before anything else runs. A spec from
 * `loadSpec` is already bundled, so this only acts on a spec given as an object.
 */
export function bundleExternalRefs(): DocumentPlugin {
  return {
    name: 'bundle-external-refs',
    process({ spec }) {
      return new ExternalRefBundler(spec, Documents.standard()).bundle();
    },
  };
}
