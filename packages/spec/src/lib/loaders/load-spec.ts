import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { Documents } from '../documents/documents.js';
import { SpecLoader } from './spec-loader.js';

/**
 * Loads the document at `location` and every document it references, bundled
 * into one spec whose references are all local. `documents` lists the URI of
 * each document read, `location` first.
 */
export async function loadSpec(
  location: string,
): Promise<{ spec: OpenAPIObject; documents: string[] }> {
  const documents = Documents.standard([]);
  const spec = await new SpecLoader(documents).load(documentUrl(location));
  return { spec, documents: documents.uris() };
}

function documentUrl(location: string) {
  return ['http:', 'https:', 'file:'].some((scheme) =>
    location.startsWith(scheme),
  )
    ? new URL(location)
    : pathToFileURL(resolve(location));
}
