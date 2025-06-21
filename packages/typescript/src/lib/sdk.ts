import type { OpenAPIObject, ResponseObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import { isEmpty, pascalcase } from '@sdk-it/core';
import {
  type OperationPagination,
  type TunedOperationObject,
  isErrorStatusCode,
  isStreamingContentType,
  isSuccessStatusCode,
  isTextContentType,
  parseJsonContentType,
  sanitizeTag,
} from '@sdk-it/spec';

import { TypeScriptEmitter } from './emitters/interface.ts';
import statusMap from './status-map.ts';
import type { Style } from './style.ts';
import { type Import, type MakeImportFn } from './utils.ts';

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

export type Options = Record<
  string,
  {
    in: string;
    schema: string;
    optionName?: string;
  }
>;
export interface Spec {
  name: string;
  options: Options;
  servers: string[];
  operations: Record<string, Operation[]>;
  makeImport: MakeImportFn;
}

export interface OperationInput {
  in: string;
  schema: string;
}
export interface Operation {
  name: string;
  method: string;
  path: string;
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
  const schemaName = camelcase(`${operation.name} schema`);
  const schemaRef = `${camelcase(groupName)}.${schemaName}`;

  const inputHeaders: string[] = [];
  const inputQuery: string[] = [];
  const inputBody: string[] = [];
  const inputParams: string[] = [];
  const schemas: string[] = [];
  const responses: ReturnType<typeof handleResponse>[] = [];
  for (const [name, prop] of Object.entries(operation.inputs)) {
    if (prop.in === 'headers' || prop.in === 'header') {
      inputHeaders.push(`"${name}"`);
    } else if (prop.in === 'query') {
      inputQuery.push(`"${name}"`);
    } else if (prop.in === 'body') {
      inputBody.push(`"${name}"`);
    } else if (prop.in === 'path') {
      inputParams.push(`"${name}"`);
    } else if (prop.in === 'internal') {
      // ignore internal sources
      continue;
    } else {
      throw new Error(
        `Unknown source ${prop.in} in ${name} ${JSON.stringify(
          prop,
        )} in ${operation.name}`,
      );
    }
  }

  specOperation.responses ??= {};
  const outputs: string[] = [];

  for (const status in specOperation.responses) {
    const handled = handleResponse(
      spec,
      operation.name,
      status,
      specOperation.responses[status],
      utils,
    );
    responses.push(handled);
    outputs.push(...handled.outputs);
  }

  const addTypeParser = Object.keys(operation.schemas).length > 1;
  for (const type in operation.schemas ?? {}) {
    let typePrefix = '';
    if (addTypeParser && type !== 'json') {
      typePrefix = `${type} `;
    }

    const endpoint = `${typePrefix}${operation.method.toUpperCase()} ${operation.path}`;
    schemas.push(
      `"${endpoint}": {
          schema: ${schemaRef}${addTypeParser ? `.${type}` : ''},
          output:[${outputs.join(',')}],
          toRequest(input: z.infer<typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}>) {
           return toRequest('${endpoint}', ${operation.outgoingContentType || 'empty'}(input, {
              inputHeaders: [${inputHeaders}],
              inputQuery: [${inputQuery}],
              inputBody: [${inputBody}],
              inputParams: [${inputParams}],
            }));},
         async dispatch(input: z.infer<typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}>,options: {
            signal?: AbortSignal;
            interceptors: Interceptor[];
            fetch: z.infer<typeof fetchType>;
          })${specOperation['x-pagination'] ? paginationOperation(specOperation, utils.style) : normalOperation(utils.style)}`,
    );
  }
  return { responses, schemas };
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

function handleResponse(
  spec: OpenAPIObject,
  operationName: string,
  status: string,
  response: ResponseObject,
  utils: { makeImport: MakeImportFn },
) {
  const schemas: Record<string, string> = {};
  const imports: Record<string, Import> = {};
  const endpointImports: Record<string, Import> = {
    ParseError: {
      defaultImport: undefined,
      isTypeOnly: false,
      moduleSpecifier: utils.makeImport(`../http/parser`),
      namedImports: [{ isTypeOnly: false, name: 'ParseError' }],
      namespaceImport: undefined,
    },
  };
  const responses: { name: string; schema: string; description?: string }[] =
    [];
  const outputs: string[] = [];
  const typeScriptDeserialzer = new TypeScriptEmitter(spec);
  const statusCode = +status;
  const statusName = `http.${statusMap[status] || 'APIResponse'}`;
  const interfaceName = pascalcase(sanitizeTag(response['x-response-name']));

  let parser: Parser = 'buffered';
  if (isEmpty(response.content)) {
    responses.push({
      name: interfaceName,
      schema: 'void',
      description: response.description,
    });
    // endpointImports[interfaceName] = {
    //   defaultImport: undefined,
    //   isTypeOnly: true,
    //   moduleSpecifier: `../outputs/${utils.makeImport(spinalcase(operationName))}`,
    //   namedImports: [{ isTypeOnly: true, name: interfaceName }],
    //   namespaceImport: undefined,
    // };
  } else {
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
    parser = contentTypeResult.parser;
    const responseSchema = contentTypeResult.responseSchema;
    responses.push({
      name: interfaceName,
      schema: responseSchema,
      description: response.description,
    });
    if (isErrorStatusCode(statusCode)) {
      endpointImports[statusMap[status] ?? 'APIError'] = {
        moduleSpecifier: utils.makeImport('../http/response'),
        namedImports: [{ name: statusMap[status] ?? 'APIError' }],
      };
      // endpointImports[interfaceName] = {
      //   isTypeOnly: true,
      //   moduleSpecifier: `../outputs/${utils.makeImport(spinalcase(operationName))}`,
      //   namedImports: [{ isTypeOnly: true, name: interfaceName }],
      // };
    } else if (isSuccessStatusCode(statusCode)) {
      // endpointImports[interfaceName] = {
      //   defaultImport: undefined,
      //   isTypeOnly: true,
      //   moduleSpecifier: `../outputs/${utils.makeImport(spinalcase(operationName))}`,
      //   namedImports: [{ isTypeOnly: true, name: interfaceName }],
      //   namespaceImport: undefined,
      // };
    }
  }

  if (statusCode === 204) {
    outputs.push(statusName);
  } else {
    if (status.endsWith('XX')) {
      outputs.push(`http.APIError<outputs.${interfaceName}>`);
    } else {
      outputs.push(
        parser !== 'buffered'
          ? `{type: ${statusName}<outputs.${interfaceName}>, parser: ${parser}}`
          : `${statusName}<outputs.${interfaceName}>`,
      );
    }
  }

  return { schemas, imports, endpointImports, responses, outputs };
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
