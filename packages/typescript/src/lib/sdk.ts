import { camelcase } from 'stringcase';

import { type OpenAPISecuritySchemeObject } from '@sdk-it/core';
import {
  type OperationPagination,
  type ResponseBody,
  type TunedOperationObject,
  type TunedResponseObject,
} from '@sdk-it/spec';

import { groupIdentifier } from './group-identifier.ts';
import { type MakeImportFn } from './import-utilities.ts';
import type { ModelNamer } from './model-name.ts';
import { paginationOperation } from './pagination-emit.ts';
import statusMap from './status-map.ts';

export type Parser = 'chunked' | 'buffered' | 'sse' | 'bodyless';

export interface SdkConfig {
  /**
   * The name of the sdk client
   */
  name: string;
  packageName?: string;
  options?: Record<string, unknown>;
  emptyBodyAsNull?: boolean;
  stripBodyFromGetAndHead?: boolean;
  output: string;
}

export interface Spec {
  name: string;
  securitySchemes: Record<string, OpenAPISecuritySchemeObject>;
  servers: string[];
  operations: Record<string, Operation[]>;
  makeImport: MakeImportFn;
}

export interface OperationInput {
  in: string;
  schema: string;
}
export interface Operation {
  method: string;
  path: string;
  operationId: string;
  schemas: Record<string, string>;
  inputs: Record<string, OperationInput>;
  outgoingContentType?: string;
}

export function toEndpoint(
  groupName: string,
  specOperation: TunedOperationObject,
  operation: Operation,
  modelName: ModelNamer,
) {
  const schemaName = camelcase(`${specOperation.operationId} schema`);
  const schemaRef = `${groupIdentifier(groupName)}.${schemaName}`;

  const schemas: string[] = [];
  specOperation.responses ??= {};
  const outputs = Object.keys(specOperation.responses).map((status) =>
    toHttpOutput(status, specOperation.responses[status], modelName),
  );

  const addTypeParser = Object.keys(operation.schemas).length > 1;
  for (const type in operation.schemas ?? {}) {
    let typePrefix = '';
    if (addTypeParser && type !== 'json') {
      typePrefix = `${type} `;
    }
    const paths = inputToPath(specOperation, operation.inputs);
    const endpoint = `${typePrefix}${operation.method.toUpperCase()} ${operation.path}`;
    schemas.push(
      `"${endpoint}": {
          security: ${JSON.stringify(specOperation.security ?? [])} as readonly Record<string, readonly string[]>[],
          schema: ${schemaRef}${addTypeParser ? `.${type}` : ''},
          output:[${outputs.join(',')}],
          toRequest(input: z.input<typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}>) {
           return toRequest('${endpoint}', ${operation.outgoingContentType || 'empty'}(input, {
              inputHeaders: [${paths.inputHeaders}],
              inputQuery: [${paths.inputQuery}],
              inputBody: [${paths.inputBody}],
              inputParams: [${paths.inputParams}],
            }));},
         async dispatch(input: z.output<typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}>,options: {
            signal?: AbortSignal;
            interceptors: Interceptor[];
            fetch: z.infer<typeof fetchType>;
          })${specOperation['x-pagination'] ? paginationOperation(specOperation['x-pagination'] as OperationPagination) : normalOperation()}`,
    );
  }
  return { schemas };
}

function normalOperation() {
  return `{
            const dispatcher = new Dispatcher(options.interceptors, options.fetch);
            return dispatcher.send(this.toRequest(input), this.output, options?.signal);
            },
          }`;
}

const bodyParser: Record<ResponseBody, Parser> = {
  json: 'buffered',
  text: 'buffered',
  binary: 'buffered',
  empty: 'bodyless',
  stream: 'chunked',
  sse: 'sse',
};

export function toHttpOutput(
  status: string,
  response: TunedResponseObject,
  modelName: ModelNamer,
) {
  const body = response['x-body'];
  const type = status.endsWith('XX')
    ? 'http.APIError'
    : `http.${statusMap[status] || 'APIResponse'}`;
  if (status === '204') {
    return type;
  }
  const data = dataType(status, response, modelName);
  const parser = bodyParser[body];
  return parser === 'buffered'
    ? `${type}<${data}>`
    : `{type: ${type}<${data}>, parser: ${parser}}`;
}

function dataType(
  status: string,
  response: TunedResponseObject,
  modelName: ModelNamer,
) {
  switch (response['x-body']) {
    case 'empty':
      return 'null';
    case 'stream':
      return 'ReadableStream';
    case 'sse':
      return 'SSEListener';
    default:
      return `outputs.${modelName(outputName(status, response))}`;
  }
}

function outputName(status: string, response: TunedResponseObject) {
  const name = response['x-response-name'];
  if (!name) {
    throw new Error(
      `Response ${status} has a ${response['x-body']} body but no output name; generate with responses.flattenErrorResponses so every response is normalized`,
    );
  }
  return name;
}

export function inputToPath(
  operation: TunedOperationObject,
  inputs: Record<string, OperationInput>,
) {
  const inputHeaders: string[] = [];
  const inputQuery: string[] = [];
  const inputBody: string[] = [];
  const inputParams: string[] = [];
  for (const [name, prop] of Object.entries(inputs)) {
    if (prop.in === 'headers' || prop.in === 'header') {
      inputHeaders.push(`"${name}"`);
    } else if (prop.in === 'query') {
      inputQuery.push(`"${name}"`);
    } else if (prop.in === 'body') {
      inputBody.push(`"${name}"`);
    } else if (prop.in === 'path') {
      inputParams.push(`"${name}"`);
    } else {
      throw new Error(
        `Unknown source ${prop.in} in ${name} ${JSON.stringify(
          prop,
        )} in ${operation.operationId}`,
      );
    }
  }

  return {
    inputHeaders,
    inputQuery,
    inputBody,
    inputParams,
  };
}
