import type {
  OperationObject,
  ParameterObject,
  RequestBodyObject,
  SchemaObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';

import { findUniqueSchemaName } from '../find-unique-schema-name.js';
import { iterateOperations } from '../for-each-operation.js';
import type { ProcessingPlugin } from '../processing.js';
import { securityToOptions } from '../security.js';
import type {
  IR,
  OurRequestBodyObject,
  TunedOperationObject,
} from '../types.js';

export function patchParameters(
  spec: IR,
  schema: SchemaObject,
  parameters: ParameterObject[],
  security: SecurityRequirementObject[],
) {
  const securityOptions = securityToOptions(
    spec,
    security,
    spec.components.securitySchemes,
  );

  const required = new Set(
    Array.isArray(schema.required) ? schema.required : [],
  );
  schema['x-properties'] ??= {};
  for (const param of parameters) {
    if (param.required) {
      required.add(param.name);
    }
    schema['x-properties'][param.name] = {
      'x-in': param.in,
      ...(isRef(param.schema)
        ? followRef<SchemaObject>(spec, param.schema.$ref)
        : (param.schema ?? { type: 'string' })),
    };
  }
  for (const param of securityOptions) {
    required.delete(param.name);
    schema['x-properties'][param.name] = {
      'x-in': 'header',
      ...(isRef(param.schema)
        ? followRef<SchemaObject>(spec, param.schema.$ref)
        : (param.schema ?? { type: 'string' })),
    };
  }
  schema['x-required'] = [...required];
}

function normalizeRequestBody(
  spec: IR,
  operationId: string,
  operation: OperationObject,
  parameters: ParameterObject[],
  security: SecurityRequirementObject[],
): OurRequestBodyObject {
  const requestBodySource = isRef(operation.requestBody)
    ? followRef<RequestBodyObject>(spec, operation.requestBody.$ref)
    : (operation.requestBody ?? {
        content: {},
        required: false,
      });
  const requestBody = structuredClone(requestBodySource);
  if (isEmpty(requestBody.content)) {
    const inputName = findUniqueSchemaName(spec, operationId, [
      'input',
      'payload',
      'request',
    ]);
    const schema: SchemaObject = {
      'x-inputname': inputName,
      'x-requestbody': true,
    };
    patchParameters(spec, schema, parameters, security);
    const normalized: OurRequestBodyObject = {
      ...requestBody,
      content: {
        'application/empty': {
          schema: { $ref: `#/components/schemas/${inputName}` },
        },
      },
    };

    spec.components.schemas[inputName] = schema;
    return normalized;
  }
  for (const contentType in requestBody.content) {
    const mediaType = requestBody.content[contentType];
    const inputName = findUniqueSchemaName(spec, operationId, [
      'input',
      'payload',
      'request',
    ]);
    let schema: SchemaObject | undefined;

    switch (true) {
      case isRef(mediaType.schema):
        schema = structuredClone(
          followRef<SchemaObject>(spec, mediaType.schema.$ref),
        );
        break;
      case isEmpty(mediaType.schema):
        schema ??= {};
        console.warn(
          `Request body schema for content type "${contentType}" is empty.`,
        );
        break;
      default:
        schema = structuredClone(mediaType.schema);
        break;
    }

    patchParameters(spec, schema, parameters, security);
    spec.components.schemas[inputName] = {
      ...schema,
      'x-requestbody': true,
      'x-inputname': inputName,
    };

    requestBody.content[contentType].schema = {
      $ref: `#/components/schemas/${inputName}`,
    };
  }
  return requestBody as OurRequestBodyObject;
}

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
        tunedOperation.requestBody = normalizeRequestBody(
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
