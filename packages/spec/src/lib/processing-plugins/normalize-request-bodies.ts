import type {
  OperationObject,
  ParameterObject,
  RequestBodyObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';

import { findUniqueSchemaName } from '../find-unique-schema-name.js';
import { iterateOperations } from '../for-each-operation.js';
import type { ProcessingPlugin } from '../processing.js';
import type { IR, OurRequestBodyObject } from '../types.js';

export function patchParameters(
  spec: IR,
  schema: SchemaObject,
  parameters: ParameterObject[],
) {
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
  schema['x-required'] = [...required];
}

/**
 * The object a generator types for a schema: its own properties plus the
 * parameters {@link patchParameters} records beside them, every required name
 * included.
 */
export function withParameters(schema: SchemaObject): SchemaObject {
  const merged = structuredClone(schema);
  if (merged['x-properties']) {
    merged.properties = { ...merged.properties, ...merged['x-properties'] };
  }
  if (merged['x-required']) {
    merged.required = [
      ...new Set([...(merged.required ?? []), ...merged['x-required']]),
    ];
  }
  return merged;
}

function normalizeRequestBody(
  spec: IR,
  operationId: string,
  operation: OperationObject,
  parameters: ParameterObject[],
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
    patchParameters(spec, schema, parameters);
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
  const content: OurRequestBodyObject['content'] = {};
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

    patchParameters(spec, schema, parameters);
    spec.components.schemas[inputName] = {
      ...schema,
      'x-requestbody': true,
      'x-inputname': inputName,
    };

    content[contentType] = {
      ...mediaType,
      schema: { $ref: `#/components/schemas/${inputName}` },
    };
  }
  return { ...requestBody, content };
}

export function normalizeRequestBodies(): ProcessingPlugin {
  return {
    name: 'normalize-request-bodies',
    process({ spec }) {
      for (const { entry, operation } of iterateOperations(spec)) {
        const { operationId, parameters } = operation;
        if (
          !operationId ||
          !parameters?.every(
            (parameter): parameter is ParameterObject => !isRef(parameter),
          )
        ) {
          throw new Error(
            `Cannot normalize request bodies before assigning an operation ID and resolving parameters for ${entry.method.toUpperCase()} ${entry.path}`,
          );
        }
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
            schemas.every(
              (schema): schema is SchemaObject => !!schema?.['x-requestbody'],
            )
          ) {
            for (const schema of new Set(schemas)) {
              patchParameters(spec, schema, parameters);
            }
            continue;
          }
        }
        operation.requestBody = normalizeRequestBody(
          spec,
          operationId,
          operation,
          parameters,
        );
      }
    },
  };
}
