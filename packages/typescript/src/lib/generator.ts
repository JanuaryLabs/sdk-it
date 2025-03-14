import { get, merge } from 'lodash-es';
import type {
  ContentObject,
  OpenAPIObject,
  OperationObject,
  ParameterLocation,
  ParameterObject,
  ResponseObject,
} from 'openapi3-ts/oas31';
import { camelcase, pascalcase, spinalcase } from 'stringcase';

import { TypeScriptDeserialzer } from './emitters/interface.ts';
import { ZodDeserialzer } from './emitters/zod.ts';
import { type Operation, type Spec } from './sdk.ts';
import { followRef, isRef, securityToOptions, useImports } from './utils.ts';

export interface NamedImport {
  name: string;
  alias?: string;
  isTypeOnly: boolean;
}
export interface Import {
  isTypeOnly: boolean;
  moduleSpecifier: string;
  defaultImport: string | undefined;
  namedImports: NamedImport[];
  namespaceImport: string | undefined;
}

const responses: Record<string, string> = {
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

export interface GenerateSdkConfig {
  spec: OpenAPIObject;
  target?: 'javascript';
  /**
   * No support for jsdoc in vscode
   * @issue https://github.com/microsoft/TypeScript/issues/38106
   */
  style?: 'github';
  operationId?: (
    operation: OperationObject,
    path: string,
    method: string,
  ) => string;
}

export const defaults: Partial<GenerateSdkConfig> &
  Required<Pick<GenerateSdkConfig, 'operationId'>> = {
  target: 'javascript',
  style: 'github',
  operationId: (operation, path, method) => {
    if (operation.operationId) {
      return spinalcase(operation.operationId);
    }
    return camelcase(`${method} ${path.replace(/[\\/\\{\\}]/g, ' ').trim()}`);
  },
};

export function generateCode(config: GenerateSdkConfig) {
  const commonSchemas: Record<string, string> = {};
  const commonZod = new Map<string, string>();
  const commonZodImports: Import[] = [];
  const zodDeserialzer = new ZodDeserialzer(config.spec, (model, schema) => {
    commonZod.set(model, schema);
    commonZodImports.push({
      defaultImport: undefined,
      isTypeOnly: true,
      moduleSpecifier: `./${model}.ts`,
      namedImports: [{ isTypeOnly: true, name: model }],
      namespaceImport: undefined,
    });
  });

  const groups: Spec['operations'] = {};
  const outputs: Record<string, string> = {};

  for (const [path, methods] of Object.entries(config.spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods) as [
      string,
      OperationObject,
    ][]) {
      const formatOperationId = config.operationId ?? defaults.operationId;
      const operationName = formatOperationId(operation, path, method);

      console.log(`Processing ${method} ${path}`);
      const groupName = (operation.tags ?? ['unknown'])[0];
      groups[groupName] ??= [];
      const inputs: Operation['inputs'] = {};

      const additionalProperties: ParameterObject[] = [];
      for (const param of operation.parameters ?? []) {
        if (isRef(param)) {
          throw new Error(`Found reference in parameter ${param.$ref}`);
        }
        if (!param.schema) {
          throw new Error(`Schema not found for parameter ${param.name}`);
        }
        inputs[param.name] = {
          in: param.in,
          schema: '',
        };
        additionalProperties.push(param);
      }

      const security = operation.security ?? [];
      const securitySchemas = config.spec.components?.securitySchemes ?? {};

      const securityOptions = securityToOptions(security, securitySchemas);

      Object.assign(inputs, securityOptions);

      additionalProperties.push(
        ...Object.entries(securityOptions).map(
          ([name, value]) =>
            ({
              name: name,
              required: false,
              schema: {
                type: 'string',
              },
              in: value.in as ParameterLocation,
            }) satisfies ParameterObject,
        ),
      );

      const types: Record<string, string> = {};
      const shortContenTypeMap: Record<string, string> = {
        'application/json': 'json',
        'application/x-www-form-urlencoded': 'urlencoded',
        'multipart/form-data': 'formdata',
        'application/xml': 'xml',
        'text/plain': 'text',
      };
      let contentType: string | undefined;
      if (operation.requestBody && Object.keys(operation.requestBody).length) {
        const content: ContentObject = isRef(operation.requestBody)
          ? get(followRef(config.spec, operation.requestBody.$ref), ['content'])
          : operation.requestBody.content;

        for (const type in content) {
          const ctSchema = isRef(content[type].schema)
            ? followRef(config.spec, content[type].schema.$ref)
            : content[type].schema;
          if (!ctSchema) {
            console.warn(`Schema not found for ${type}`);
            continue;
          }
          const schema = merge({}, ctSchema, {
            required: additionalProperties
              .filter((p) => p.required)
              .map((p) => p.name),
            properties: additionalProperties.reduce<Record<string, unknown>>(
              (acc, p) => ({
                ...acc,
                [p.name]: p.schema,
              }),
              {},
            ),
          });
          for (const [name] of Object.entries(ctSchema.properties ?? {})) {
            inputs[name] = {
              in: 'body',
              schema: '',
            };
          }
          types[shortContenTypeMap[type]] = zodDeserialzer.handle(schema, true);
        }

        if (content['application/json']) {
          contentType = 'json';
        } else if (content['application/x-www-form-urlencoded']) {
          contentType = 'urlencoded';
        } else if (content['multipart/form-data']) {
          contentType = 'formdata';
        } else {
          contentType = 'json';
        }
      } else {
        const properties = additionalProperties.reduce<Record<string, any>>(
          (acc, p) => ({
            ...acc,
            [p.name]: p.schema,
          }),
          {},
        );
        types[shortContenTypeMap['application/json']] = zodDeserialzer.handle(
          {
            type: 'object',
            required: additionalProperties
              .filter((p) => p.required)
              .map((p) => p.name),
            properties,
          },
          true,
        );
      }

      const errors: string[] = [];
      operation.responses ??= {};

      let foundResponse = false;
      const output = [`import z from 'zod';`];
      for (const status in operation.responses) {
        const response = operation.responses[status] as ResponseObject;
        const statusCode = +status;
        if (statusCode >= 400) {
          errors.push(responses[status] ?? 'ProblematicResponse');
        }
        if (statusCode >= 200 && statusCode < 300) {
          foundResponse = true;
          const responseContent = get(response, ['content']);
          const isJson = responseContent && responseContent['application/json'];
          // TODO: how the user is going to handle multiple response types
          const imports: Import[] = [];
          const typeScriptDeserialzer = new TypeScriptDeserialzer(
            config.spec,
            (schemaName, zod) => {
              commonSchemas[schemaName] = zod;
              imports.push({
                defaultImport: undefined,
                isTypeOnly: true,
                moduleSpecifier: `../models/${schemaName}.ts`,
                namedImports: [{ isTypeOnly: true, name: schemaName }],
                namespaceImport: undefined,
              });
            },
          );
          const responseSchema = isJson
            ? typeScriptDeserialzer.handle(
                responseContent['application/json'].schema!,
                true,
              )
            : 'ReadableStream'; // non-json response treated as stream
          output.push(...useImports(responseSchema, imports));
          output.push(
            `export type ${pascalcase(operationName + ' output')} = ${responseSchema}`,
          );
        }
      }

      if (!foundResponse) {
        output.push(
          `export type ${pascalcase(operationName + ' output')} = void`,
        );
      }
      outputs[`${spinalcase(operationName)}.ts`] = output.join('\n');
      groups[groupName].push({
        name: operationName,
        type: 'http',
        inputs,
        errors: errors.length ? errors : ['ServerError'],
        contentType,
        schemas: types,
        formatOutput: () => ({
          import: pascalcase(operationName + ' output'),
          use: pascalcase(operationName + ' output'),
        }),
        trigger: {
          path,
          method,
        },
      });
    }
  }

  return { groups, commonSchemas, commonZod, outputs };
}

// TODO - USE CASES
// 1. Some parameters conflicts with request body
// 2. Generate 400 and 500 response variations // done
// 3. Generate 200 response variations
// 3. Doc Security
// 4. Operation Security
// 5. JsDocs
// 5. test all different types of parameters
// 6. cookies
// 6. x-www-form-urlencoded // done
// 7. multipart/form-data // done
// 7. application/octet-stream // done
// 7. chunked response // done
// we need to remove the stream fn in the backend
