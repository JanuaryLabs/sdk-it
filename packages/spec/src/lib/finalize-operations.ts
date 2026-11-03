import type {
  OperationObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
} from 'openapi3-ts/oas31';

import { methods } from '@sdk-it/core/paths.js';
import { isRef } from '@sdk-it/core/ref.js';

import { isJsonObject } from './external-documents.js';
import {
  type IR,
  type IRPaths,
  type OperationTool,
  type OurRequestBodyObject,
  type ProcessingDocument,
  type ResponseBody,
  type TunedOperationObject,
  type TunedResponseObject,
  responseBodies,
} from './types.js';

function isResponseBody(value: unknown): value is ResponseBody {
  return responseBodies.some((body) => body === value);
}

/**
 * Builds the IR from a document the document-stage plugins have processed.
 * This is the one place a raw operation becomes a {@link TunedOperationObject};
 * an operation left untuned is a spec processing bug, so it throws.
 */
export function finalizeOperations(document: ProcessingDocument): IR {
  const paths: IRPaths = {};
  for (const [path, pathItem] of Object.entries(document.paths)) {
    const operations: IRPaths[string] = {};
    for (const method of methods) {
      const operation = pathItem[method];
      if (operation) {
        operations[method] = finalizeOperation(
          `${method.toUpperCase()} ${path}`,
          operation,
        );
      }
    }
    paths[path] = operations;
  }
  return { ...document, paths };
}

function untuned(operation: string, field: string, problem: string) {
  return new Error(
    `Spec processing left ${operation} with an untuned ${field}: ${problem}`,
  );
}

function finalizeOperation(
  name: string,
  operation: OperationObject,
): TunedOperationObject {
  const {
    operationId,
    tags,
    parameters,
    responses,
    requestBody,
    security,
    'x-tool': tool,
    ...rest
  } = operation;
  const fnName: unknown = operation['x-fn-name'];
  const fnGroup: unknown = operation['x-fn-group'];
  if (typeof operationId !== 'string') {
    throw untuned(name, 'operationId', 'it is not a string');
  }
  if (typeof fnName !== 'string') {
    throw untuned(name, 'x-fn-name', 'it is not a string');
  }
  if (typeof fnGroup !== 'string') {
    throw untuned(name, 'x-fn-group', 'it is not a string');
  }
  const [tag] = tags ?? [];
  if (tags?.length !== 1 || tag === undefined) {
    throw untuned(name, 'tags', 'it does not hold exactly one tag');
  }
  if (
    !parameters?.every(
      (parameter): parameter is ParameterObject => !isRef(parameter),
    )
  ) {
    throw untuned(name, 'parameters', 'a parameter is missing or a $ref');
  }
  if (!security) {
    throw untuned(name, 'security', 'it is missing');
  }
  return {
    ...rest,
    operationId,
    tags: [tag],
    parameters,
    security,
    'x-fn-name': fnName,
    'x-fn-group': fnGroup,
    responses: finalizeResponses(name, responses ?? {}),
    requestBody: finalizeRequestBody(name, requestBody),
    ...operationTool(tool),
  };
}

function operationTool(tool: unknown): { 'x-tool'?: OperationTool } {
  if (!isJsonObject(tool)) {
    return {};
  }
  const { name, description } = tool;
  return {
    'x-tool': {
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
    },
  };
}

function finalizeResponses(
  name: string,
  responses: Record<string, ResponseObject | ReferenceObject>,
) {
  const tuned: Record<string, TunedResponseObject> = {};
  for (const [status, response] of Object.entries(responses)) {
    const field = `responses.${status}`;
    if (isRef(response)) {
      throw untuned(name, field, 'it is a $ref');
    }
    const { content } = response;
    const body: unknown = response['x-body'];
    if (!content) {
      throw untuned(name, `${field}.content`, 'it is missing');
    }
    if (!isResponseBody(body)) {
      throw untuned(name, `${field}.x-body`, 'it is not a response body kind');
    }
    tuned[status] = { ...response, content, 'x-body': body };
  }
  return tuned;
}

function finalizeRequestBody(
  name: string,
  requestBody: RequestBodyObject | ReferenceObject | undefined,
): OurRequestBodyObject {
  if (!requestBody) {
    throw untuned(name, 'requestBody', 'it is missing');
  }
  if (isRef(requestBody)) {
    throw untuned(name, 'requestBody', 'it is a $ref');
  }
  const content: OurRequestBodyObject['content'] = {};
  for (const [contentType, media] of Object.entries(requestBody.content)) {
    const { schema } = media;
    if (!isRef(schema)) {
      throw untuned(
        name,
        `requestBody.content.${contentType}.schema`,
        'it is not a $ref to a request body schema',
      );
    }
    content[contentType] = { ...media, schema };
  }
  return { ...requestBody, content };
}
