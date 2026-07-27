import { parse as parseContentType } from 'fast-content-type-parse';
import type {
  MediaTypeObject,
  OperationObject,
  ResponseObject,
} from 'openapi3-ts/oas31';

import { isRef, parseRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty, pascalcase } from '@sdk-it/core/utils.js';

import { findUniqueSchemaName } from '../find-unique-schema-name.js';
import { iterateOperations } from '../for-each-operation.js';
import {
  isBinaryContentType,
  isSseContentType,
  isStreamingContentType,
  isSuccessStatusCode,
  isTextContentType,
  parseJsonContentType,
} from '../is.js';
import type { ResponsesConfig } from '../options.js';
import type { ProcessingPlugin } from '../processing.js';
import type { IR, TunedOperationObject } from '../types.js';

function normalizeOperationResponses(
  spec: IR,
  operationId: string,
  operation: OperationObject,
  responsesConfig?: ResponsesConfig,
) {
  const responses = operation.responses ?? {};
  operation.responses ??= {};
  let foundSuccessResponse = false;
  for (const status in responses) {
    operation.responses[status] = structuredClone(
      resolveRef<ResponseObject>(spec, responses[status]),
    );

    if (status !== 'default' && isSuccessStatusCode(status)) {
      foundSuccessResponse = true;
    }
  }

  if (!foundSuccessResponse) {
    operation.responses['200'] = {
      description: 'OK',
      content: {
        'application/json': {
          schema: {},
        },
      },
    };
  }

  for (const status in operation.responses) {
    const response = operation.responses[status] as ResponseObject;
    const statusCode = +status;

    if (
      !responsesConfig?.flattenErrorResponses &&
      !isSuccessStatusCode(status)
    ) {
      continue;
    }

    if (isEmpty(response.content)) {
      response.content = {
        'application/octet-stream': {},
      };
    }

    let responseName: string | undefined;
    for (const [contentType, mediaType] of Object.entries(
      response.content as Record<string, MediaTypeObject>,
    )) {
      if (isRef(mediaType.schema)) {
        const { model } = parseRef(mediaType.schema.$ref);
        Object.assign(spec.components.schemas[model], {
          'x-responsebody': true,
        });
        responseName ??= model;
        continue;
      }
      const outputName =
        statusCode !== 200
          ? findUniqueSchemaName(spec, `${pascalcase(operationId)}${status}`, [
              'output',
              'payload',
              'result',
            ])
          : findUniqueSchemaName(spec, operationId, [
              'output',
              'payload',
              'result',
            ]);
      responseName ??= outputName;
      const isSse = isSseContentType(contentType);
      const normalizedContentType = normalizeContentType(contentType);
      const hasContentDisposition = hasHeader(
        response.headers,
        'Content-Disposition',
      );
      const isBinary =
        isBinaryContentType(contentType) ||
        (isStreamingContentType(normalizedContentType) &&
          hasContentDisposition);
      const isText = isTextContentType(contentType);

      if (parseJsonContentType(contentType)) {
        if (isEmpty(mediaType.schema)) {
          spec.components.schemas[outputName] = {
            type: 'object',
            additionalProperties: true,
          };
        }
      } else {
        if (isEmpty(mediaType.schema) && (isText || isBinary)) {
          mediaType.schema = {
            type: 'string',
            ...(isBinary ? { format: 'binary' } : {}),
          };
        }
        spec.components.schemas[outputName] = {
          ...spec.components.schemas[outputName],
          'x-stream': isSse || (!isText && !isBinary),
          ...(isSse ? { 'x-sse': true } : {}),
        };
      }

      spec.components.schemas[outputName] = {
        ...spec.components.schemas[outputName],
        ...mediaType.schema,
        'x-responsebody': true,
        'x-response-group': operationId,
      };
      operation.responses[status].content[contentType].schema = {
        $ref: `#/components/schemas/${outputName}`,
      };
    }
    if (responseName) {
      response['x-response-name'] = responseName;
    }
  }

  return operation.responses;
}

function normalizeContentType(contentType: string) {
  try {
    return parseContentType(contentType)?.type?.toLowerCase();
  } catch {
    return contentType.split(';')[0]?.trim().toLowerCase();
  }
}

function hasHeader(headers: ResponseObject['headers'], name: string) {
  if (!headers) {
    return false;
  }
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

export function normalizeResponses(): ProcessingPlugin {
  return {
    name: 'normalize-responses',
    process({ spec, options, report }) {
      for (const { entry, operation } of iterateOperations(spec)) {
        if (!operation.operationId) {
          throw new Error(
            `Cannot normalize responses before assigning an operation ID for ${entry.method.toUpperCase()} ${entry.path}`,
          );
        }
        const hadSuccessResponse = Object.keys(operation.responses ?? {}).some(
          isSuccessStatusCode,
        );
        (operation as TunedOperationObject).responses =
          normalizeOperationResponses(
            spec,
            operation.operationId,
            operation,
            options.responses,
          );
        if (!hadSuccessResponse) {
          report({
            severity: 'warning',
            code: 'success-response-added',
            message: 'Added a default 200 success response',
            path: `${entry.method.toUpperCase()} ${entry.path}`,
          });
        }
      }
    },
  };
}
