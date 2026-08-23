import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import type { OpenAPIDocument } from '@sdk-it/core';

import { loadLocal } from './local-loader.js';
import { convertPostmanToOpenAPI } from './postman/postman-converter.js';
import type { PostmanCollection } from './postman/spec-types.js';
import { loadRemote } from './remote-loader.js';

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
export async function loadSpec(location: string): Promise<OpenAPIObject> {
  let content = await loadFile(location);
  if (isPostman(content)) {
    content = convertPostmanToOpenAPI(content);
  }
  const spec = content as OpenAPIDocument;
  // Relative references inside the document resolve against where it came from.
  spec.$self ??= documentUri(location);
  return spec as OpenAPIObject;
}

export function loadFile<T>(location: string): Promise<T> {
  if (isRemote(location)) {
    return loadRemote(location);
  }
  return loadLocal(location);
}

function documentUri(location: string) {
  return isRemote(location) || location.startsWith('file:')
    ? location
    : pathToFileURL(resolve(location)).href;
}

function isRemote(location: string) {
  const [protocol] = location.split(':');
  return protocol === 'http' || protocol === 'https';
}
