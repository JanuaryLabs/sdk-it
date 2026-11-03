import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import { pascalcase } from 'stringcase';

import { followRef, isRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty, sortArray } from '@sdk-it/core/utils.js';

import {
  isTextContentType,
  isXmlContentType,
  parseJsonContentType,
} from './is.js';
import { withParameters } from './processing-plugins/normalize-request-bodies.js';
import type { IR, TunedOperationObject } from './types.js';

/** How a client writes a request body, in the order a client prefers them. */
const requestEncodings = [
  'json',
  'urlencoded',
  'formdata',
  'text',
  'binary',
  'empty',
] as const;

export type RequestEncoding = (typeof requestEncodings)[number];

/** The encoding a client sends a body of media type `contentType` with. */
function requestEncoding(contentType: string): RequestEncoding {
  const mainType = contentType.split(';')[0].trim().toLowerCase();
  if (mainType === 'application/empty') {
    return 'empty';
  }
  if (parseJsonContentType(mainType)) {
    return 'json';
  }
  if (mainType === 'application/x-www-form-urlencoded') {
    return 'urlencoded';
  }
  if (mainType === 'multipart/form-data') {
    return 'formdata';
  }
  if (isTextContentType(mainType) || isXmlContentType(mainType)) {
    return 'text';
  }
  return 'binary';
}

/** How a client sends an operation: its body encoding, its input and where each input goes. */
export interface OperationInput {
  /** Whether a client exposes this input under the operation's own key and name; every other input is a variant. */
  preferred: boolean;
  /** The request media type the client sends. */
  contentType: string;
  encoding: RequestEncoding;
  /** The input object a client accepts: its body fields or `$body`, plus its parameters. */
  schema: SchemaObject;
  header: string[];
  query: string[];
  body: string[];
  path: string[];
}

function bodyObject(
  operation: TunedOperationObject,
  body: SchemaObject,
  parameters: SchemaObject,
): SchemaObject {
  return {
    type: 'object',
    required: operation.requestBody.required ? ['$body'] : [],
    properties: { $body: body },
    ...parameters,
  };
}

/**
 * A text body is a string and a binary body a Blob, whatever structure the
 * media type's schema describes (an XML document is sent as written); a string
 * schema keeps its own constraints.
 */
function rawBody(
  schema: SchemaObject,
  encoding: 'text' | 'binary',
): SchemaObject {
  if (schema.type === 'string') {
    return schema;
  }
  return encoding === 'text'
    ? { type: 'string' }
    : { type: 'string', format: 'binary' };
}

/**
 * The object for `contentType` before its parameters are folded in: an empty
 * body becomes an object of parameters only, and a text or binary body, or any
 * other body that is not an object, becomes `$body`.
 */
function requestObject(
  ir: IR,
  operation: TunedOperationObject,
  contentType: string,
  encoding: RequestEncoding,
): SchemaObject {
  const schema = resolveRef<SchemaObject>(
    ir,
    operation.requestBody.content[contentType].schema,
  );
  const parameters = {
    'x-properties': schema['x-properties'],
    'x-required': schema['x-required'],
  };
  switch (encoding) {
    case 'empty':
      // An operation without a body or parameters still takes an object, so
      // the client accepts any input instead of none.
      return {
        type: 'object',
        additionalProperties: isEmpty(schema['x-properties']),
        ...parameters,
      };
    case 'text':
    case 'binary':
      return bodyObject(operation, rawBody(schema, encoding), parameters);
    default:
      return schema.type === 'object'
        ? schema
        : bodyObject(operation, schema, parameters);
  }
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

function toInput(
  ir: IR,
  operation: TunedOperationObject,
  contentType: string,
  encoding: RequestEncoding,
  preferred: boolean,
): OperationInput {
  const object = requestObject(ir, operation, contentType, encoding);
  const input: OperationInput = {
    preferred,
    contentType,
    encoding,
    schema: withParameters(object),
    header: [],
    query: [],
    body: [],
    path: [],
  };
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
  return input;
}

/**
 * Every way a client can send `operation`: one input per encoding it accepts,
 * the preferred input first, then the variants in {@link requestEncodings}
 * order. Within one encoding the media type the operation declares first wins.
 */
export function operationInputs(
  ir: IR,
  operation: TunedOperationObject,
): OperationInput[] {
  const contentTypes = new Map<RequestEncoding, string>();
  for (const contentType of Object.keys(operation.requestBody.content)) {
    const encoding = requestEncoding(contentType);
    if (!contentTypes.has(encoding)) {
      contentTypes.set(encoding, contentType);
    }
  }
  const inputs: OperationInput[] = [];
  for (const encoding of requestEncodings) {
    const contentType = contentTypes.get(encoding);
    if (contentType) {
      inputs.push(
        toInput(ir, operation, contentType, encoding, inputs.length === 0),
      );
    }
  }
  return inputs;
}

function holdsBinary(
  ir: IR,
  schema: SchemaObject | ReferenceObject,
  seen: Set<string>,
): boolean {
  if (isRef(schema)) {
    if (seen.has(schema.$ref)) {
      return false;
    }
    seen.add(schema.$ref);
    return holdsBinary(ir, followRef(ir, schema.$ref), seen);
  }
  if (
    schema.format === 'binary' ||
    schema.format === 'byte' ||
    schema.contentEncoding === 'binary'
  ) {
    return true;
  }
  const children = [
    ...Object.values(schema.properties ?? {}),
    ...(schema.items ? [schema.items] : []),
    ...(typeof schema.additionalProperties === 'object'
      ? [schema.additionalProperties]
      : []),
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ];
  return children.some((child) => holdsBinary(ir, child, seen));
}

/** Whether `input` carries binary data (a file field or a Blob body), which a JSON tool call cannot send. */
export function carriesBinary(ir: IR, input: OperationInput): boolean {
  return holdsBinary(ir, input.schema, new Set());
}

/** The key a client exposes `input` under: `endpoint` itself for the preferred input, `formdata POST /upload` for a variant of `POST /upload`. */
export function inputEndpoint(endpoint: string, input: OperationInput): string {
  return input.preferred ? endpoint : `${input.encoding} ${endpoint}`;
}

/** The name of `input` of an operation called `name`: `name` itself for the preferred input, `uploadFileFormdata` for a variant of `uploadFile`. */
export function inputName(name: string, input: OperationInput): string {
  return input.preferred ? name : `${name}${pascalcase(input.encoding)}`;
}
