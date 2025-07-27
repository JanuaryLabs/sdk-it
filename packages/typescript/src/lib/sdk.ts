import type { OpenAPIObject, ResponseObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import { isEmpty, pascalcase } from '@sdk-it/core';
import {
  type OperationPagination,
  type OurParameter,
  type TunedOperationObject,
  isStreamingContentType,
  isTextContentType,
  parseJsonContentType,
  sanitizeTag,
} from '@sdk-it/spec';

import { TypeScriptEmitter } from './emitters/interface.ts';
import { type MakeImportFn } from './import-utilities.ts';
import statusMap from './status-map.ts';
import type { Style } from './style.ts';

export type Parser = 'chunked' | 'buffered';

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
  options: OurParameter[];
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
  spec: OpenAPIObject,
  specOperation: TunedOperationObject,
  operation: Operation,
  utils: {
    makeImport: MakeImportFn;
    style?: Style;
  },
) {
  const schemaName = camelcase(`${specOperation.operationId} schema`);
  const schemaRef = `${camelcase(groupName)}.${schemaName}`;

  const schemas: string[] = [];
  specOperation.responses ??= {};
  const outputs = Object.keys(specOperation.responses).flatMap((status) =>
    toHttpOutput(
      spec,
      specOperation.operationId,
      status,
      specOperation.responses[status],
    ),
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
          schema: ${schemaRef}${addTypeParser ? `.${type}` : ''},
          output:[${outputs.join(',')}],
          toRequest(input: z.infer<typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}>) {
           return toRequest('${endpoint}', ${operation.outgoingContentType || 'empty'}(input, {
              inputHeaders: [${paths.inputHeaders}],
              inputQuery: [${paths.inputQuery}],
              inputBody: [${paths.inputBody}],
              inputParams: [${paths.inputParams}],
            }));},
         async dispatch(input: z.infer<typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}>,options: {
            signal?: AbortSignal;
            interceptors: Interceptor[];
            fetch: z.infer<typeof fetchType>;
          })${specOperation['x-pagination'] ? paginationOperation(specOperation, utils.style) : normalOperation(utils.style)}`,
    );
  }
  return { schemas };
}

function normalOperation(style?: Style) {
  return `{
            const dispatcher = new Dispatcher(options.interceptors, options.fetch);
            const result = await dispatcher.send(this.toRequest(input), this.output);
            return ${style?.outputType === 'status' ? 'result' : style?.errorAsValue ? `result` : 'result.data;'}
            },
          }`;
}

function paginationOperation(operation: TunedOperationObject, style?: Style) {
  const pagination = operation['x-pagination'] as OperationPagination;
  const data = `${style?.errorAsValue ? `result[0]${style.outputType === 'status' ? '' : ''}` : `${style?.outputType === 'default' ? 'result.data' : 'result.data'}`}`;
  const returnValue = `${style?.errorAsValue ? `[${style?.outputType === 'status' ? 'new http.Ok(pagination)' : 'pagination'}, null]` : `${style?.outputType === 'status' ? 'new http.Ok(pagination);' : 'pagination'}`}`;
  if (pagination.type === 'offset') {
    const sameInputNames =
      pagination.limitParamName === 'limit' &&
      pagination.offsetParamName === 'offset';
    const initialParams = sameInputNames
      ? 'input'
      : `{...input, limit: input.${pagination.limitParamName}, offset: input.${pagination.offsetParamName}}`;

    const nextPageParams = sameInputNames
      ? '...nextPageParams'
      : `${pagination.offsetParamName}: nextPageParams.offset, ${pagination.limitParamName}: nextPageParams.limit`;
    const logic = `const pagination = new OffsetPagination(${initialParams}, async (nextPageParams) => {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const result = await dispatcher.send(
          this.toRequest({...input, ${nextPageParams}}),
          this.output,
        );
        return {
          data: ${data}.${pagination.items},
          meta: {
            hasMore: Boolean(${data}.${pagination.hasMore}),
          },
        };
      });
      await pagination.getNextPage();
      return ${returnValue}
      `;
    return style?.errorAsValue
      ? `{try {${logic}} catch (error) {return [null as never, error] as const;}}}`
      : `{${logic}}}`;
  }
  if (pagination.type === 'cursor') {
    const sameInputNames = pagination.cursorParamName === 'cursor';
    const initialParams = sameInputNames
      ? 'input'
      : `{...input, cursor: input.${pagination.cursorParamName}}`;

    const nextPageParams = sameInputNames
      ? '...nextPageParams'
      : `${pagination.cursorParamName}: nextPageParams.cursor`;
    const logic = `
      const pagination = new CursorPagination(${initialParams}, async (nextPageParams) => {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const result = await dispatcher.send(
          this.toRequest({...input, ${nextPageParams}}),
          this.output,
        );
        ${style?.errorAsValue ? `if (result[1]) {throw result[1];}` : ''}
        return {
          data: ${data}.${pagination.items},
          meta: {
            hasMore: Boolean(${data}.${pagination.hasMore}),
          },
        };
      });
      await pagination.getNextPage();
      return ${returnValue}
      `;
    return style?.errorAsValue
      ? `{try {${logic}} catch (error) {return [null as never, error] as const;}}}`
      : `{${logic}}}`;
  }
  if (pagination.type === 'page') {
    const sameInputNames =
      pagination.pageNumberParamName === 'page' &&
      pagination.pageSizeParamName === 'pageSize';
    const initialParams = sameInputNames
      ? 'input'
      : `{...input, page: input.${pagination.pageNumberParamName}, pageSize: input.${pagination.pageSizeParamName}}`;
    const nextPageParams = sameInputNames
      ? '...nextPageParams'
      : `${pagination.pageNumberParamName}: nextPageParams.page, ${pagination.pageSizeParamName}: nextPageParams.pageSize`;

    const logic = `
      const pagination = new Pagination(${initialParams}, async (nextPageParams) => {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const result = await dispatcher.send(
          this.toRequest({...input, ${nextPageParams}}),
          this.output,
        );
        ${style?.errorAsValue ? `if (result[1]) {throw result[1];}` : ''}
        return {
          data: ${data}.${pagination.items},
          meta: {
            hasMore: Boolean(${data}.${pagination.hasMore}),
          },
        };
      });
      await pagination.getNextPage();
      return ${returnValue}
      `;
    return style?.errorAsValue
      ? `{try {${logic}} catch (error) {return [null as never, error] as const;}}}`
      : `{${logic}}}`;
  }
  return normalOperation(style);
}

export function toHttpOutput(
  spec: OpenAPIObject,
  operationName: string,
  status: string,
  response: ResponseObject,
  withGenerics = true,
) {
  const typeScriptDeserialzer = new TypeScriptEmitter(spec);
  const interfaceName = pascalcase(sanitizeTag(response['x-response-name']));

  if (!isEmpty(response.content)) {
    const contentTypeResult = fromContentType(
      spec,
      typeScriptDeserialzer,
      response,
    );
    if (!contentTypeResult) {
      throw new Error(
        `No recognizable content type for response ${status} in operation ${operationName}`,
      );
    }
    const parser: Parser = contentTypeResult.parser || 'buffered';
    const outputs: string[] = [];
    const statusName = `http.${statusMap[status] || 'APIResponse'}`;
    const statusCode = +status;
    if (statusCode === 204) {
      outputs.push(statusName);
    } else {
      const generic = withGenerics ? `<outputs.${interfaceName}>` : '';
      if (status.endsWith('XX')) {
        outputs.push(`http.APIError${generic}`);
      } else {
        if (parser !== 'buffered') {
          outputs.push(`{type: ${statusName}${generic}, parser: ${parser}}`);
        } else {
          outputs.push(`${statusName}${generic}`);
        }
      }
    }
    return outputs;
  }
  return [];
}

function fromContentType(
  spec: OpenAPIObject,
  typeScriptDeserialzer: TypeScriptEmitter,
  response: ResponseObject,
) {
  if ((response.headers ?? {})['Transfer-Encoding']) {
    return streamedOutput();
  }
  for (const type in response.content) {
    if (isStreamingContentType(type)) {
      return streamedOutput();
    }
    if (parseJsonContentType(type)) {
      return {
        parser: 'buffered' as const,
        responseSchema: response.content[type].schema
          ? typeScriptDeserialzer.handle(response.content[type].schema, true)
          : 'void',
      };
    }
    if (isTextContentType(type)) {
      return {
        parser: 'buffered' as const,
        responseSchema: response.content[type].schema
          ? typeScriptDeserialzer.handle(response.content[type].schema, true)
          : 'void',
      };
    }
  }
  return streamedOutput();
}

function streamedOutput() {
  return {
    parser: 'chunked' as const,
    responseSchema: 'ReadableStream',
  };
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
