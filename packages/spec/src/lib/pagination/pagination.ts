import type {
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core/ref.js';

import type { IR, TunedOperationObject } from '../types.js';
import { guessPagination } from './guess-pagination.js';

export function toPagination(spec: IR, tunedOperation: TunedOperationObject) {
  if (tunedOperation['x-pagination']) {
    return tunedOperation['x-pagination'];
  }
  const schema = getResponseContentSchema(
    spec,
    tunedOperation.responses['200'],
    'application/json',
  );
  const pagination = guessPagination(
    tunedOperation,
    tunedOperation.requestBody
      ? getRequestContentSchema(
          spec,
          tunedOperation.requestBody,
          'application/json',
        )
      : undefined,
    schema,
  );
  if (pagination && pagination.type !== 'none' && schema) {
    return pagination;
  }
  return undefined;
}

function getResponseContentSchema(
  spec: IR,
  response: ResponseObject,
  type: string,
) {
  if (!response) {
    return undefined;
  }
  const content = response.content;
  if (!content) {
    return undefined;
  }
  for (const contentType in content) {
    if (contentType.toLowerCase() === type.toLowerCase()) {
      return isRef(content[contentType].schema)
        ? followRef<SchemaObject>(spec, content[contentType].schema.$ref)
        : content[contentType].schema;
    }
  }
  return undefined;
}

function getRequestContentSchema(
  spec: IR,
  requestBody: RequestBodyObject,
  type: string,
) {
  const content = requestBody.content;
  if (!content) {
    return undefined;
  }
  for (const contentType in content) {
    if (contentType.toLowerCase() === type.toLowerCase()) {
      return isRef(content[contentType].schema)
        ? followRef<SchemaObject>(spec, content[contentType].schema.$ref)
        : content[contentType].schema;
    }
  }
  return undefined;
}
