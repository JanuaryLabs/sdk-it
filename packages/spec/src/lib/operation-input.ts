import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { followRef, isRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty, sortArray } from '@sdk-it/core/utils.js';

import { withParameters } from './processing-plugins/normalize-request-bodies.js';
import type { IR, TunedOperationObject } from './types.js';

/** The request media types a client can send, in the order a client picks them. */
const requestEncodings = {
  'application/json': 'json',
  'application/x-www-form-urlencoded': 'urlencoded',
  'multipart/form-data': 'formdata',
  'application/xml': 'xml',
  'text/plain': 'text',
  'application/empty': 'empty',
} as const;

export type RequestEncoding =
  (typeof requestEncodings)[keyof typeof requestEncodings];

/** How a client sends an operation: its body encoding and where each input goes. */
export interface OperationInput {
  /** The request media type the client sends. */
  contentType: string;
  encoding: RequestEncoding;
  header: string[];
  query: string[];
  body: string[];
  path: string[];
}

/**
 * The object for `contentType` before its parameters are folded in: an empty
 * body becomes an object of parameters only, and a body that is not an object
 * becomes `$body`.
 */
function requestObject(
  ir: IR,
  operation: TunedOperationObject,
  contentType: string,
): SchemaObject {
  const schema = resolveRef<SchemaObject>(
    ir,
    operation.requestBody.content[contentType].schema,
  );
  const parameters = {
    'x-properties': schema['x-properties'],
    'x-required': schema['x-required'],
  };
  if (contentType === 'application/empty') {
    // An operation without a body or parameters still takes an object, so
    // the client accepts any input instead of none.
    return {
      type: 'object',
      additionalProperties: isEmpty(schema['x-properties']),
      ...parameters,
    };
  }
  if (schema.type !== 'object') {
    return {
      type: 'object',
      required: operation.requestBody.required ? ['$body'] : [],
      properties: { $body: schema },
      ...parameters,
    };
  }
  return schema;
}

/** The input object a client accepts for `contentType`: its body fields or `$body`, plus its parameters. */
export function inputSchema(
  ir: IR,
  operation: TunedOperationObject,
  contentType: string,
): SchemaObject {
  return withParameters(requestObject(ir, operation, contentType));
}

function bodyNames(
  ir: IR,
  schema: SchemaObject | ReferenceObject,
  names: string[],
): void {
  if (isRef(schema)) {
    bodyNames(ir, followRef(ir, schema.$ref), names);
  } else if (schema.type === 'object') {
    names.push(...Object.keys(schema.properties ?? {}));
  } else if (
    (schema.type === 'array' || schema.type?.includes('array')) &&
    schema.items
  ) {
    bodyNames(ir, schema.items, names);
  } else if (schema.allOf) {
    for (const part of schema.allOf) bodyNames(ir, part, names);
  } else if (schema.oneOf) {
    for (const part of schema.oneOf) bodyNames(ir, part, names);
  } else if (schema.anyOf) {
    for (const part of schema.anyOf) bodyNames(ir, part, names);
  } else {
    console.warn('Unknown schema in body', schema);
  }
}

/**
 * How a client sends `operation`: the first media type it accepts in
 * {@link requestEncodings} order, and each input's location for it.
 */
export function operationInput(
  ir: IR,
  operation: TunedOperationObject,
): OperationInput {
  const input: OperationInput = {
    contentType: 'application/empty',
    encoding: 'empty',
    header: [],
    query: [],
    body: [],
    path: [],
  };
  for (const [contentType, encoding] of Object.entries(requestEncodings)) {
    if (!operation.requestBody.content[contentType]) {
      continue;
    }
    const object = requestObject(ir, operation, contentType);
    const locations: Record<string, string> = {};
    for (const [name, parameter] of Object.entries<SchemaObject>(
      object['x-properties'],
    )) {
      locations[name] = parameter['x-in'];
    }
    const names: string[] = [];
    bodyNames(ir, object, names);
    for (const name of sortArray(names)) {
      locations[name] = 'body';
    }
    for (const [name, location] of Object.entries(locations)) {
      switch (location) {
        case 'header':
        case 'headers':
          input.header.push(name);
          break;
        case 'query':
          input.query.push(name);
          break;
        case 'body':
          input.body.push(name);
          break;
        case 'path':
          input.path.push(name);
          break;
        default:
          throw new Error(
            `Unknown source ${location} in ${name} in ${operation.operationId}`,
          );
      }
    }
    return { ...input, contentType, encoding };
  }
  return input;
}
