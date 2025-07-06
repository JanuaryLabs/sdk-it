import type {
  OperationObject,
  ParameterObject,
  RequestBodyObject,
  SchemaObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';

import { findUniqueSchemaName } from './find-unique-schema-name.js';
import { securityToOptions } from './security.js';
import type { OurOpenAPIObject, OurRequestBodyObject } from './types.js';

export function patchParameters(
  spec: OurOpenAPIObject,
  schema: SchemaObject,
  parameters: ParameterObject[],
  security: SecurityRequirementObject[],
) {
  const securitySchemes = spec.components?.securitySchemes ?? {};
  const securityOptions = securityToOptions(spec, security, securitySchemes);

  let required = Array.isArray(schema.required) ? schema.required : [];
  schema['x-properties'] ??= {};
  for (const param of parameters) {
    if (param.required) {
      required.push(param.name);
    }
    schema['x-properties'][param.name] = {
      'x-in': param.in,
      ...(isRef(param.schema)
        ? followRef<SchemaObject>(spec, param.schema.$ref)
        : (param.schema ?? { type: 'string' })),
    };
  }
  for (const param of securityOptions) {
    required = required.filter((name) => name !== param.name);
    schema['x-properties'][param.name] = {
      'x-in': 'header',
      ...(isRef(param.schema)
        ? followRef<SchemaObject>(spec, param.schema.$ref)
        : (param.schema ?? { type: 'string' })),
    };
  }
  schema['x-required'] = required;
}

export function tuneRequestBody(
  spec: OurOpenAPIObject,
  operationId: string,
  operation: OperationObject,
  parameters: ParameterObject[],
  security: SecurityRequirementObject[],
): OurRequestBodyObject {
  const inputName = findUniqueSchemaName(spec, operationId, [
    'input',
    'payload',
    'request',
  ]);
  const requestBody = isRef(operation.requestBody)
    ? followRef<RequestBodyObject>(spec, operation.requestBody.$ref)
    : (operation.requestBody ?? {
        content: {},
        required: false,
      });
  if (isEmpty(requestBody.content)) {
    const schema: SchemaObject = {
      'x-inputname': inputName,
      'x-requestbody': true,
    };
    patchParameters(spec, schema, parameters, security);
    const tuned: OurRequestBodyObject = {
      ...requestBody,
      content: {
        'application/empty': {
          schema: { $ref: `#/components/schemas/${inputName}` },
        },
      },
    };

    spec.components.schemas[inputName] = schema;
    return tuned;
  }
  for (const contentType in requestBody.content) {
    const mediaType = requestBody.content[contentType];
    let schema: SchemaObject | undefined;

    switch (true) {
      case isRef(mediaType.schema):
        schema = followRef<SchemaObject>(spec, mediaType.schema.$ref);
        // we cannot use the model name as inputName as it might be used in other places that are not request bodies
        // inputName = parseRef(mediaType.schema.$ref).model;
        break;
      case isEmpty(mediaType.schema):
        schema ??= {}; // default to empty schema if not defined
        console.warn(
          `Request body schema for content type "${contentType}" is empty.`,
        );
        break;
      default:
        schema = mediaType.schema;
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
