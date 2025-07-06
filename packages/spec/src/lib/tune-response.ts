import type {
  MediaTypeObject,
  OperationObject,
  ResponseObject,
} from 'openapi3-ts/oas31';

import { isRef, parseRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty, pascalcase } from '@sdk-it/core/utils.js';

import { findUniqueSchemaName } from './find-unique-schema-name.js';
import {
  isSseContentType,
  isSuccessStatusCode,
  isTextContentType,
  parseJsonContentType,
} from './is.js';
import { type ResponsesConfig } from './options.js';
import type { OurOpenAPIObject } from './types.js';

export function resolveResponses(
  spec: OurOpenAPIObject,
  operationId: string,
  operation: OperationObject,
  responsesConfig?: ResponsesConfig,
) {
  const responses = operation.responses ?? {};
  operation.responses ??= {};
  let foundSuccessResponse = false;
  for (const status in responses) {
    if (status === 'default') {
      delete responses[status]; // Skip default response
      continue;
    }
    // use structuredClone to avoid mutating a response object
    // that is referenced by multiple operations
    operation.responses[status] = structuredClone(
      resolveRef<ResponseObject>(spec, responses[status]),
    );

    if (isSuccessStatusCode(status)) {
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

    const outputName =
      statusCode !== 200
        ? pascalcase(operationId) + status
        : findUniqueSchemaName(spec, operationId, [
            'output',
            'payload',
            'result',
          ]);

    if (!responsesConfig?.flattenErrorResponses) {
      if (!isSuccessStatusCode(status)) {
        continue;
      }
    }

    if (isEmpty(response.content)) {
      response.content = {
        'application/octet-stream': {},
      };
    }

    response['x-response-name'] = outputName;

    // if (isErrorStatusCode(status)) {
    //   const mediaType = response.content?.['application/json'];
    //   if (mediaType && isRef(mediaType.schema)) {
    //     const { model } = parseRef(mediaType.schema.$ref);
    //     Object.assign(config.spec.components.schemas[model], {
    //       'x-responsebody': true,
    //       // do not assign response ref to a group
    //       // because they are supposed to be in a separate file only inlined
    //       // schemas are grouped by operationId
    //     });
    //     response['x-response-name'] = model;
    //   }
    //   continue;
    // }

    for (const [contentType, mediaType] of Object.entries(
      response.content as Record<string, MediaTypeObject>,
    )) {
      if (isRef(mediaType.schema)) {
        const { model } = parseRef(mediaType.schema.$ref);
        Object.assign(spec.components.schemas[model], {
          'x-responsebody': true,
          // do not assign response ref to a group
          // because they are supposed to be in a separate file only inlined
          // schemas are grouped by operationId
        });
        response['x-response-name'] = model;
        continue;
      }
      if (isSseContentType(contentType)) {
        continue; // Skip SSE content types
      }
      if (parseJsonContentType(contentType)) {
        if (isEmpty(mediaType.schema)) {
          // add "additionalProperties" because we're certain this is a response body is of json type
          spec.components.schemas[outputName] = {
            type: 'object',
            additionalProperties: true,
          };
        }
      } else {
        spec.components.schemas[outputName] = {
          ...spec.components.schemas[outputName],
          'x-stream': !isTextContentType(contentType),
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
  }

  return operation.responses;
}
