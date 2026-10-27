import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import type { OpenAPIDocument } from '@sdk-it/core';

import { type Documents, isRemote, loadFile } from '../external-documents.js';
import { bundleDocument } from '../processing-plugins/bundle-external-refs.js';
import { registerExternalSecuritySchemes } from '../processing-plugins/resolve-security-scheme-uris.js';
import { convertPostmanToOpenAPI } from './postman/postman-converter.js';
import type { PostmanCollection } from './postman/spec-types.js';

function isPostman(content: unknown): content is PostmanCollection {
  return (
    typeof content === 'object' &&
    content !== null &&
    'info' in content &&
    typeof content.info === 'object' &&
    content.info !== null &&
    'item' in content &&
    Array.isArray(content.item) &&
    'schema' in content.info &&
    typeof content.info.schema === 'string' &&
    content.info.schema.includes('//schema.getpostman.com/')
  );
}

/**
 * Loads the document at `location` and every document it references, bundled
 * into one spec whose references are all local. `documents` lists the URI of
 * each document read, `location` first.
 */
export async function loadSpec(
  location: string,
): Promise<{ spec: OpenAPIObject; documents: string[] }> {
  let content = await loadFile(location);
  if (isPostman(content)) {
    content = convertPostmanToOpenAPI(content);
  }
  const spec = content as OpenAPIDocument;
  const entry = documentUri(location);
  // Relative references inside the document resolve against where it came from.
  spec.$self ??= entry;
  const documents: Documents = new Map();
  await bundleDocument(spec, documents);
  // A scheme URI that fails stays a URI key; toIR reports it as a diagnostic.
  await registerExternalSecuritySchemes(spec, documents);
  return {
    spec: spec as OpenAPIObject,
    documents: [...new Set([entry, ...documents.keys()])],
  };
}

function documentUri(location: string) {
  return isRemote(location) || location.startsWith('file:')
    ? location
    : pathToFileURL(resolve(location)).href;
}
