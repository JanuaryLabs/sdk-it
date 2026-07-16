import type { RequestBodyObject, SchemaObject } from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core/ref.js';

import { iterateOperations } from '../for-each-operation.js';
import type { ProcessingPlugin } from '../processing.js';
import { patchParameters, tuneRequestBody } from '../tune-request-body.js';
import type { TunedOperationObject } from '../types.js';

export function normalizeRequestBodies(): ProcessingPlugin {
  return {
    name: 'normalize-request-bodies',
    process({ spec }) {
      for (const { operation } of iterateOperations(spec)) {
        const tunedOperation = operation as TunedOperationObject;
        if (operation.requestBody) {
          const requestBody = resolveRef<RequestBodyObject>(
            spec,
            operation.requestBody,
          );
          const schemas = Object.values(requestBody.content).map(
            ({ schema }) =>
              schema ? resolveRef<SchemaObject>(spec, schema) : undefined,
          );
          if (
            schemas.length > 0 &&
            schemas.every((schema) => schema?.['x-requestbody'])
          ) {
            for (const schema of new Set(schemas)) {
              patchParameters(
                spec,
                schema as SchemaObject,
                tunedOperation.parameters,
                operation.security ?? [],
              );
            }
            continue;
          }
        }
        tunedOperation.requestBody = tuneRequestBody(
          spec,
          tunedOperation.operationId,
          operation,
          tunedOperation.parameters,
          operation.security ?? [],
        );
      }
    },
  };
}
