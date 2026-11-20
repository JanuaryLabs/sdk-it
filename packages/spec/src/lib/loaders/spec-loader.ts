import type { OpenAPIObject } from 'openapi3-ts/oas31';

import type { OpenAPIDocument } from '@sdk-it/core';

import { ExternalRefBundler } from '../bundling/external-ref-bundler.js';
import { ExternalSecuritySchemes } from '../bundling/external-security-schemes.js';
import type { Documents } from '../documents/documents.js';
import { DocumentParseError } from '../documents/errors.js';
import { isJsonObject } from '../json.js';
import { convertPostmanToOpenAPI } from './postman/postman-converter.js';
import type { PostmanCollection } from './postman/spec-types.js';

/** A format an entry document can be written in, read as an OpenAPI document. */
interface SpecFormat {
  /** The document as OpenAPI, or undefined when `content` is not in this format. */
  read(content: unknown): OpenAPIObject | undefined;
}

class PostmanFormat implements SpecFormat {
  read(content: unknown) {
    return isPostman(content) ? convertPostmanToOpenAPI(content) : undefined;
  }
}

class OpenApiFormat implements SpecFormat {
  read(content: unknown) {
    return isDocument(content) ? content : undefined;
  }
}

const formats: readonly SpecFormat[] = [
  new PostmanFormat(),
  new OpenApiFormat(),
];

function isPostman(content: unknown): content is PostmanCollection {
  return (
    isJsonObject(content) &&
    isJsonObject(content['info']) &&
    Array.isArray(content['item']) &&
    typeof content['info']['schema'] === 'string' &&
    content['info']['schema'].includes('//schema.getpostman.com/')
  );
}

function isDocument(content: unknown): content is OpenAPIObject {
  return isJsonObject(content);
}

/** Reads an entry document through `documents` and bundles every document it references into it. */
export class SpecLoader {
  readonly #documents: Documents;

  constructor(documents: Documents) {
    this.#documents = documents;
  }

  /** The spec at `entry`, with only local references. */
  async load(entry: URL): Promise<OpenAPIObject> {
    const content = await this.#documents.load(entry);
    for (const format of formats) {
      const spec = format.read(content);
      if (spec) {
        return this.#bundle(spec, entry);
      }
    }
    throw new DocumentParseError(entry, {
      cause: new Error('the document is not a JSON or YAML object'),
    });
  }

  async #bundle(spec: OpenAPIObject, entry: URL) {
    const document: OpenAPIDocument = spec;
    // Relative references inside the document resolve against where it came from.
    document.$self ??= entry.href;
    await new ExternalRefBundler(document, this.#documents).bundle();
    // A scheme URI that fails stays a URI key; toIR reports it as a diagnostic.
    await new ExternalSecuritySchemes(document, this.#documents).register();
    return spec;
  }
}
