import type { OpenAPIObject } from 'openapi3-ts/oas31';

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
  const content = await loadFile(location);
  if (isPostman(content)) {
    return convertPostmanToOpenAPI(content);
  }
  return content as OpenAPIObject;
}

export function loadFile<T>(location: string): Promise<T> {
  const [protocol] = location.split(':');
  if (protocol === 'http' || protocol === 'https') {
    return loadRemote(location);
  }
  return loadLocal(location);
}
