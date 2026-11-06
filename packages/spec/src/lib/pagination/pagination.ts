import type {
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core/ref.js';

import { isSuccessStatusCode } from '../is.js';
import type { IR, TunedOperationObject } from '../types.js';
import { guessPagination } from './guess-pagination.js';
import { getNextCursorName } from './pagination-result.js';

export function toPagination(spec: IR, tunedOperation: TunedOperationObject) {
  const configured = tunedOperation['x-pagination'];
  if (configured && (configured.type !== 'cursor' || configured.nextCursor)) {
    return configured;
  }
  const successResponse = Object.entries(tunedOperation.responses).find(
    ([status]) =>
      configured
        ? Number(status) === configured.statusCode
        : isSuccessStatusCode(status) && Number.isInteger(Number(status)),
  );
  const statusCode = successResponse ? Number(successResponse[0]) : undefined;
  const schema = successResponse
    ? getResponseContentSchema(spec, successResponse[1], 'application/json')
    : undefined;
  const body = tunedOperation.requestBody
    ? getRequestContentSchema(
        spec,
        tunedOperation.requestBody,
        'application/json',
      )
    : undefined;
  const pagination =
    configured ?? guessPagination(tunedOperation, body, schema);
  if (
    pagination &&
    pagination.type !== 'none' &&
    schema &&
    statusCode !== undefined
  ) {
    if (pagination.type === 'cursor') {
      const nextCursor = getNextCursorName(schema, spec);
      return {
        ...pagination,
        statusCode,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
    const start = startOf(
      spec,
      tunedOperation,
      body,
      pagination.type === 'offset'
        ? pagination.offsetParamName
        : pagination.pageNumberParamName,
    );
    return {
      ...pagination,
      statusCode,
      ...(start === undefined ? {} : { start }),
    };
  }
  return configured;
}

/** The default the spec gives the parameter that positions the first page, a query parameter or a JSON body property. */
function startOf(
  spec: IR,
  operation: TunedOperationObject,
  body: SchemaObject | undefined,
  name: string,
) {
  const schema =
    operation.parameters.find((parameter) => parameter.name === name)?.schema ??
    body?.properties?.[name];
  const resolved = isRef(schema)
    ? followRef<SchemaObject>(spec, schema.$ref)
    : schema;
  return typeof resolved?.default === 'number' ? resolved.default : undefined;
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
