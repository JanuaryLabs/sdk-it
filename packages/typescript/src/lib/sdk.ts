import { type OpenAPISecuritySchemeObject } from '@sdk-it/core';
import {
  type OperationInput,
  type OperationPagination,
  type ResponseBody,
  type TunedOperationObject,
  type TunedResponseObject,
} from '@sdk-it/spec';

import { groupIdentifier } from './group-identifier.ts';
import { type MakeImportFn } from './import-utilities.ts';
import type { ModelNamer } from './model-name.ts';
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

/** One way a client sends an operation: the key it is exposed under and the input it takes. */
export interface OperationRoute {
  endpoint: string;
  /** The name the `inputs` module exports the input schema under. */
  schemaName: string;
  /** The input schema as zod source. */
  zod: string;
  input: OperationInput;
}

export interface Operation {
  method: string;
  path: string;
  operationId: string;
  /** The preferred input first, then its variants. */
  inputs: OperationRoute[];
}

export function toEndpoint(
  groupName: string,
  specOperation: TunedOperationObject,
  operation: Operation,
  modelName: ModelNamer,
) {
  const schemas: string[] = [];
  specOperation.responses ??= {};
  const outputs = Object.keys(specOperation.responses).map((status) =>
    toHttpOutput(status, specOperation.responses[status], modelName),
  );

  for (const route of operation.inputs) {
    const schemaRef = `${groupIdentifier(groupName)}.${route.schemaName}`;
    schemas.push(
      `"${route.endpoint}": {
          security: ${JSON.stringify(specOperation.security ?? [])} as readonly Record<string, readonly string[]>[],
          schema: ${schemaRef},
          output:[${outputs.join(',')}],
          toRequest(input: z.input<typeof ${schemaRef}>, baseUrl: string) {
           return toRequest('${operation.method.toUpperCase()}', '${operation.path}', ${route.input.encoding}(input, {
              contentType: ${JSON.stringify(route.input.contentType)},
              inputHeaders: [${quoted(route.input.header)}],
              inputQuery: [${quoted(route.input.query)}],
              inputBody: [${quoted(route.input.body)}],
              inputParams: [${quoted(route.input.path)}],
            }), baseUrl);},
         async dispatch(input: z.output<typeof ${schemaRef}>,options: {
            signal?: AbortSignal;
            interceptors: Interceptor[];
            fetch: z.infer<typeof fetchType>;
            baseUrl: string;
          })${normalOperation(specOperation['x-pagination'])}`,
    );
  }
  return { schemas };
}

function normalOperation(pagination: OperationPagination | undefined) {
  return `{
            const dispatcher = new Dispatcher(options.interceptors, options.fetch);
            return dispatcher.send(this.toRequest(input, options.baseUrl), this.output, options?.signal);
            },${pagination ? `\n          pagination: ${JSON.stringify(runtimePagination(pagination))} as const,` : ''}
          }`;
}

/**
 * The fields of an operation's pagination that @sdk-it/runtime's Page reads.
 * `JSON.stringify` omits the optional ones that are undefined.
 */
function runtimePagination(pagination: OperationPagination) {
  const { items, hasMore, statusCode } = pagination;
  switch (pagination.type) {
    case 'offset':
      return {
        type: pagination.type,
        offsetParamName: pagination.offsetParamName,
        limitParamName: pagination.limitParamName,
        items,
        hasMore,
        statusCode,
        start: pagination.start,
      };
    case 'page':
      return {
        type: pagination.type,
        pageNumberParamName: pagination.pageNumberParamName,
        pageSizeParamName: pagination.pageSizeParamName,
        items,
        hasMore,
        statusCode,
        start: pagination.start,
      };
    case 'cursor':
      return {
        type: pagination.type,
        cursorParamName: pagination.cursorParamName,
        items,
        hasMore,
        statusCode,
        nextCursor: pagination.nextCursor,
      };
  }
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

function quoted(names: readonly string[]) {
  return names.map((name) => `"${name}"`);
}
