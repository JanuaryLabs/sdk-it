import { get } from 'lodash-es';
import type {
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  ResponseObject,
} from 'openapi3-ts/oas31';
import { camelcase, pascalcase, spinalcase } from 'stringcase';

import { toLitObject } from '@sdk-it/core';

import { TypeScriptDeserialzer } from './emitters/interface.ts';
import { type Import, type MakeImportFn, followRef, isRef } from './utils.ts';

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
  specOperation: OperationObject,
  operation: Operation,
  utils: {
    makeImport: MakeImportFn;
  },
) {
  const schemaName = camelcase(`${operation.name} schema`);
  const schemaRef = `${camelcase(groupName)}.${schemaName}`;

  const inputHeaders: string[] = [];
  const inputQuery: string[] = [];
  const inputBody: string[] = [];
  const inputParams: string[] = [];
  const endpoints: string[] = [];
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
  for (const status in specOperation.responses) {
    const response = isRef(
      specOperation.responses[status] as ResponseObject | ReferenceObject,
    )
      ? (followRef(
          spec,
          specOperation.responses[status].$ref,
        ) as ResponseObject)
      : (specOperation.responses[status] as ResponseObject);
    const handled = handleResponse(
      spec,
      operation.name,
      status,
      response,
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
    const input = `typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}`;

    const endpoint = `${typePrefix}${operation.trigger.method.toUpperCase()} ${operation.trigger.path}`;
    endpoints.push(
      `"${endpoint}": {
        input: z.infer<${input}>;
        output: ${outputs.join('|')};
        error: ${['ServerError'].concat(`ParseError<${input}>`).join('|')}
      };`,
    );

    schemas.push(
      `"${endpoint}": {
          schema: ${schemaRef}${addTypeParser ? `.${type}` : ''},
          output:[${outputs.join(',')}],
          toRequest(input: z.infer<typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}>) {
            const endpoint = '${endpoint}';
                return toRequest(endpoint, ${operation.outgoingContentType || 'nobody'}(input, {
                inputHeaders: [${inputHeaders}],
                inputQuery: [${inputQuery}],
                inputBody: [${inputBody}],
                inputParams: [${inputParams}],
              }));
            },
          }`,
    );
  }
  return { responses, schemas };
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
  const errors: string[] = [];
  const responses: { name: string; schema: string }[] = [];
  const outputs: string[] = [];
  const typeScriptDeserialzer = new TypeScriptDeserialzer(
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
  const statusName = statusCodeToResponseMap[status] || 'Ok';
  const interfaceName = pascalcase(
    operationName + ` output${numbered ? status : ''}`,
  );

  if (statusCode === 204) {
    outputs.push(statusName);
  } else {
    outputs.push(
      parser !== 'buffered'
        ? `{type: ${statusName}<${interfaceName}>, parser: ${parser}}`
        : `${statusName}<${interfaceName}>`,
    );
  }
  let foundError = false;
  const responseContent = get(response, ['content']);
  const isJson = responseContent && responseContent['application/json'];
  const responseSchema = isJson
    ? typeScriptDeserialzer.handle(
        responseContent['application/json'].schema!,
        true,
      )
    : 'void';
  responses.push({
    name: interfaceName,
    schema: responseSchema,
  });
  if (statusCode >= 400) {
    foundError = true;
    errors.push(
      statusCodeToResponseMap[status]
        ? `${statusCodeToResponseMap[status]}<${responseSchema}>`
        : 'ProblematicResponse',
    );
    endpointImports[statusCodeToResponseMap[status] ?? 'ProblematicResponse'] =
      {
        defaultImport: undefined,
        isTypeOnly: false,
        moduleSpecifier: utils.makeImport('../http/response'),
        namedImports: [
          {
            isTypeOnly: false,
            name: statusCodeToResponseMap[status] ?? 'ProblematicResponse',
          },
        ],
        namespaceImport: undefined,
      };

    endpointImports[interfaceName] = {
      defaultImport: undefined,
      isTypeOnly: true,
      moduleSpecifier: `../outputs/${utils.makeImport(spinalcase(operationName))}`,
      namedImports: [{ isTypeOnly: true, name: interfaceName }],
      namespaceImport: undefined,
    };
  } else if (statusCode >= 200 && statusCode < 300) {
    endpointImports[statusName] = {
      defaultImport: undefined,
      isTypeOnly: false,
      moduleSpecifier: utils.makeImport('../http/response'),
      namedImports: [
        {
          isTypeOnly: false,
          name: statusCodeToResponseMap[status] || 'Ok',
        },
      ],
      namespaceImport: undefined,
    };

    endpointImports[interfaceName] = {
      defaultImport: undefined,
      isTypeOnly: true,
      moduleSpecifier: `../outputs/${utils.makeImport(spinalcase(operationName))}`,
      namedImports: [{ isTypeOnly: true, name: interfaceName }],
      namespaceImport: undefined,
    };
  }

  if (!foundError) {
    endpointImports['ServerError'] = {
      defaultImport: undefined,
      isTypeOnly: true,
      moduleSpecifier: utils.makeImport('../http/response'),
      namedImports: [{ isTypeOnly: true, name: 'ServerError' }],
      namespaceImport: undefined,
    };
  }

  return { schemas, imports, endpointImports, errors, responses, outputs };
}
