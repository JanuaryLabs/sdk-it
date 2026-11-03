import type {
  MediaTypeObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import {
  type IR,
  type OperationInput,
  type TunedOperationObject,
  forEachOperation,
  inputName,
  operationInputs,
} from '@sdk-it/spec';

export interface OperationDescriptor {
  operationId: string;
  name: string;
  method: string;
  path: string;
  /** The media type the command sends its body as. */
  contentType: string;
  tag?: string;
  summary?: string;
  description?: string;
  input: SchemaObject;
  responses: Record<string, SchemaObject | ReferenceObject | undefined>;
}

const CONTENT_TYPE_PRIORITY = [
  'application/json',
  'application/problem+json',
  'text/plain',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
];

function pickContentSchema(
  content: Record<string, MediaTypeObject>,
): SchemaObject | ReferenceObject | undefined {
  for (const ct of CONTENT_TYPE_PRIORITY) {
    if (content[ct]?.schema) return content[ct].schema;
  }
  const sorted = Object.keys(content).sort();
  for (const key of sorted) {
    if (content[key]?.schema) return content[key].schema;
  }
  return undefined;
}

function responseSchemas(
  operation: TunedOperationObject,
): Record<string, SchemaObject | ReferenceObject | undefined> {
  const out: Record<string, SchemaObject | ReferenceObject | undefined> = {};
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    out[status] = pickContentSchema(response.content);
  }
  return out;
}

export function describeOperation(
  op: TunedOperationObject,
  method: string,
  path: string,
  input: OperationInput,
): OperationDescriptor {
  return {
    operationId: op.operationId,
    name: inputName(op['x-fn-name'], input),
    method: method.toUpperCase(),
    path,
    contentType: input.contentType,
    tag: op.tags?.[0],
    summary: op.summary,
    description: op.description,
    input: input.schema,
    responses: responseSchemas(op),
  };
}

export function describeAllOperations(
  ir: IR,
): Record<string, OperationDescriptor> {
  const descriptors: Record<string, OperationDescriptor> = {};
  forEachOperation(ir, (entry, op) => {
    for (const input of operationInputs(ir, op)) {
      descriptors[inputName(op['x-fn-name'], input)] = describeOperation(
        op,
        entry.method,
        entry.path,
        input,
      );
    }
  });
  return descriptors;
}
