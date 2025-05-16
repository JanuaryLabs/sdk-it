import { get } from 'lodash-es';
import type { OpenAPIObject, ResponseObject } from 'openapi3-ts/oas31';
import { camelcase, pascalcase, spinalcase } from 'stringcase';

import { isRef, toLitObject } from '@sdk-it/core';
import type {
  OperationPagination,
  TunedOperationObject,
} from '@sdk-it/spec/operation.js';

import { TypeScriptEmitter } from './emitters/interface.ts';
import type { OutputStyle } from './style.ts';
import { type Import, type MakeImportFn } from './utils.ts';

export type Parser = 'chunked' | 'buffered';

export interface SdkConfig {
  /**
   * The name of the sdk client
   */
  name: string;
  packageName?: string;
  options?: Record<string, any>;
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
  type: string;
  trigger: Record<string, any>;
  schemas: Record<string, string>;
  inputs: Record<string, OperationInput>;
  outgoingContentType?: string;
}

export function generateInputs(
  operationsSet: Spec['operations'],
  commonZod: Map<string, string>,
  makeImport: MakeImportFn,
) {
  const commonImports = commonZod.keys().toArray();
  const inputs: Record<string, string> = {};
  for (const [name, operations] of Object.entries(operationsSet)) {
    const output: string[] = [];
    const imports = new Set(['import { z } from "zod";']);

    for (const operation of operations) {
      const schemaName = camelcase(`${operation.name} schema`);

      const schema = `export const ${schemaName} = ${
        Object.keys(operation.schemas).length === 1
          ? Object.values(operation.schemas)[0]
          : toLitObject(operation.schemas)
      };`;

      const inputContent = schema;

      for (const schema of commonImports) {
        if (inputContent.includes(schema)) {
          imports.add(
            `import { ${schema} } from './schemas/${makeImport(spinalcase(schema))}';`,
          );
        }
      }
      output.push(inputContent);
    }
    inputs[`inputs/${spinalcase(name)}.ts`] =
      [...imports, ...output].join('\n') + '\n';
  }

  const schemas = commonZod
    .entries()
    .reduce<string[][]>((acc, [name, schema]) => {
      const output = [`import { z } from 'zod';`];
      const content = `export const ${name} = ${schema};`;
      for (const schema of commonImports) {
        const preciseMatch = new RegExp(`\\b${schema}\\b`);
        if (preciseMatch.test(content) && schema !== name) {
          output.push(
            `import { ${schema} } from './${makeImport(spinalcase(schema))}';`,
          );
        }
      }

      output.push(content);
      return [
        [`inputs/schemas/${spinalcase(name)}.ts`, output.join('\n')],
        ...acc,
      ];
    }, []);

  return {
    ...Object.fromEntries(schemas),
    ...inputs,
  };
}

export function toEndpoint(
  groupName: string,
  spec: OpenAPIObject,
  specOperation: TunedOperationObject,
  operation: Operation,
  utils: {
    makeImport: MakeImportFn;
    style?: OutputStyle;
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

  const statusesCount =
    Object.keys(specOperation.responses).filter((status) => {
      const statusCode = +status;
      return statusCode >= 200 && statusCode < 300;
    }).length > 1;
  const responseWithAtLeast200 = statusesCount
    ? specOperation.responses
    : Object.assign(
        {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
        specOperation.responses,
      );
  for (const status in responseWithAtLeast200) {
    const handled = handleResponse(
      spec,
      operation.name,
      status,
      responseWithAtLeast200[status],
      utils,
      true,
      // statusesCount,
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

    const endpoint = `${typePrefix}${operation.trigger.method.toUpperCase()} ${operation.trigger.path}`;
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

function normalOperation(style?: OutputStyle) {
  return `{
            const dispatcher = new Dispatcher(options.interceptors, options.fetch);
            const result = await dispatcher.send(this.toRequest(input), this.output);
            return ${style === 'status' ? 'result' : 'result.data;'}
            },
          }`;
}

function paginationOperation(
  operation: TunedOperationObject,
  style?: OutputStyle,
) {
  const pagination = operation['x-pagination'] as OperationPagination;
  if (pagination.type !== 'page') {
    throw new Error(
      `Pagination type ${pagination.type} is not supported. Only page is supported`,
    );
  }
  return `{const pagination = new Pagination(input, async (nextPageParams) => {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const result = await dispatcher.send(
          this.toRequest({...input, ...nextPageParams}),
          this.output,
        );
        return {
          data: result.data.${pagination.items},
          meta: {
            hasMore: result.data.${pagination.hasMore},
          },
        };
      });
      await pagination.getNextPage();
      return ${style === 'status' ? 'new http.Ok(pagination);' : 'pagination'}}}`;
}

const statusCodeToResponseMap: Record<string, string> = {
  '200': 'Ok',
  '201': 'Created',
  '202': 'Accepted',
  '204': 'NoContent',
  '400': 'BadRequest',
  '401': 'Unauthorized',
  '402': 'PaymentRequired',
  '403': 'Forbidden',
  '404': 'NotFound',
  '405': 'MethodNotAllowed',
  '406': 'NotAcceptable',
  '409': 'Conflict',
  '413': 'PayloadTooLarge',
  '410': 'Gone',
  '422': 'UnprocessableEntity',
  '429': 'TooManyRequests',
  '500': 'InternalServerError',
  '501': 'NotImplemented',
  '502': 'BadGateway',
  '503': 'ServiceUnavailable',
  '504': 'GatewayTimeout',
};
function handleResponse(
  spec: OpenAPIObject,
  operationName: string,
  status: string,
  response: ResponseObject,
  utils: { makeImport: MakeImportFn },
  numbered: boolean,
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
  const typeScriptDeserialzer = new TypeScriptEmitter(
    spec,
    (schemaName, zod) => {
      schemas[schemaName] = zod;
      imports[schemaName] = {
        defaultImport: undefined,
        isTypeOnly: true,
        moduleSpecifier: `../models/${utils.makeImport(schemaName)}`,
        namedImports: [{ isTypeOnly: true, name: schemaName }],
        namespaceImport: undefined,
      };
    },
  );
  const statusCode = +status;
  const parser: Parser = (response.headers ?? {})['Transfer-Encoding']
    ? 'chunked'
    : 'buffered';
  const statusName = `http.${statusCodeToResponseMap[status] || 'APIResponse'}`;
  const interfaceName = pascalcase(
    operationName + ` output${numbered ? status : ''}`,
  );

  if (statusCode === 204) {
    outputs.push(statusName);
  } else {
    if (status.endsWith('XX')) {
      outputs.push(`http.APIError<${interfaceName}>`);
    } else {
      outputs.push(
        parser !== 'buffered'
          ? `{type: ${statusName}<${interfaceName}>, parser: ${parser}}`
          : `${statusName}<${interfaceName}>`,
      );
    }
  }
  const responseContent = get(response, ['content']);
  const isJson = responseContent && responseContent['application/json'];
  let responseSchema = parser === 'chunked' ? 'ReadableStream' : 'void';
  if (isJson) {
    const schema = responseContent['application/json'].schema!;
    const isObject = !isRef(schema) && schema.type === 'object';
    if (isObject && schema.properties) {
      schema.properties['[http.KIND]'] = {
        'x-internal': true,
        const: `typeof ${statusName}.kind`,
        type: 'string',
      };
      schema.required ??= [];
      schema.required.push('[http.KIND]');
    }
    responseSchema = typeScriptDeserialzer.handle(schema, true);
  }

  responses.push({
    name: interfaceName,
    schema: responseSchema,
    description: response.description,
  });
  const statusGroup = +status.slice(0, 1);
  if (statusCode >= 400 || statusGroup >= 4) {
    endpointImports[statusCodeToResponseMap[status] ?? 'APIError'] = {
      moduleSpecifier: utils.makeImport('../http/response'),
      namedImports: [{ name: statusCodeToResponseMap[status] ?? 'APIError' }],
    };

    endpointImports[interfaceName] = {
      isTypeOnly: true,
      moduleSpecifier: `../outputs/${utils.makeImport(spinalcase(operationName))}`,
      namedImports: [{ isTypeOnly: true, name: interfaceName }],
    };
  } else if (
    (statusCode >= 200 && statusCode < 300) ||
    statusCode >= 2 ||
    statusGroup <= 3
  ) {
    endpointImports[interfaceName] = {
      defaultImport: undefined,
      isTypeOnly: true,
      moduleSpecifier: `../outputs/${utils.makeImport(spinalcase(operationName))}`,
      namedImports: [{ isTypeOnly: true, name: interfaceName }],
      namespaceImport: undefined,
    };
  }
  return { schemas, imports, endpointImports, responses, outputs };
}
