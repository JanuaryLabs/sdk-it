import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import type { OpenAPIDocument } from '@sdk-it/core';

import { ExternalRefBundler } from '../bundling/external-ref-bundler.js';
import { Documents } from '../documents/documents.js';
import { DocumentParseError } from '../documents/errors.js';
import { isJsonObject } from '../json.js';
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

function isDocument(content: unknown): content is OpenAPIObject {
  return isJsonObject(content);
}

/**
 * Loads the document at `location` and every document it references, bundled
 * into one spec whose references are all local. `documents` lists the URI of
 * each document read, `location` first.
 */
export async function loadSpec(
  location: string,
): Promise<{ spec: OpenAPIObject; documents: string[] }> {
  const documents = Documents.standard();
  const entry = documentUrl(location);
  const content = await documents.load(entry);
  if (!isPostman(content) && !isDocument(content)) {
    throw new DocumentParseError(entry, {
      cause: new Error('the document is not a JSON or YAML object'),
    });
  }
  const spec = isPostman(content) ? convertPostmanToOpenAPI(content) : content;
  const document: OpenAPIDocument = spec;
  // Relative references inside the document resolve against where it came from.
  document.$self ??= entry.href;
  await new ExternalRefBundler(document, documents).bundle();
  // A scheme URI that fails stays a URI key; toIR reports it as a diagnostic.
  await registerExternalSecuritySchemes(document, documents);
  return { spec, documents: documents.uris() };
}

function documentUrl(location: string) {
  return ['http:', 'https:', 'file:'].some((scheme) =>
    location.startsWith(scheme),
  )
    ? new URL(location)
    : pathToFileURL(resolve(location));
}
