import type { SchemaObject } from 'openapi3-ts/oas31';

import {
  type IR,
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec';
import { buildInput, operationSchema } from '@sdk-it/typescript';

export interface OperationDescriptor {
  operationId: string;
  name: string;
  method: string;
  path: string;
  tag?: string;
  summary?: string;
  description?: string;
  input: SchemaObject;
  responses: Record<string, SchemaObject | undefined>;
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
  content: Record<string, { schema?: SchemaObject }>,
): SchemaObject | undefined {
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
): Record<string, SchemaObject | undefined> {
  const out: Record<string, SchemaObject | undefined> = {};
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    const content = (response as { content?: Record<string, { schema?: SchemaObject }> }).content;
    out[status] = content ? pickContentSchema(content) : undefined;
  }
  return out;
}

export function describeOperation(
  ir: IR,
  op: TunedOperationObject,
  method: string,
  path: string,
): OperationDescriptor {
  const details = buildInput(ir, op);
  const input = operationSchema(ir, op, details.ct) as SchemaObject;
  return {
    operationId: op.operationId,
    name: op['x-fn-name'],
    method: method.toUpperCase(),
    path,
    tag: op.tags?.[0],
    summary: op.summary,
    description: op.description,
    input,
    responses: responseSchemas(op),
  };
}

export function describeAllOperations(
  ir: IR,
): Record<string, OperationDescriptor> {
  const descriptors: Record<string, OperationDescriptor> = {};
  forEachOperation(ir, (entry, op) => {
    descriptors[op['x-fn-name']] = describeOperation(
      ir,
      op,
      entry.method,
      entry.path,
    );
  });
  return descriptors;
}
