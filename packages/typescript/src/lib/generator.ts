import { get, merge } from 'lodash-es';
import type {
  ContentObject,
  OpenAPIObject,
  ParameterLocation,
  ParameterObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { pascalcase, spinalcase } from 'stringcase';

import {
  type GenerateSdkConfig,
  forEachOperation,
  removeDuplicates,
} from '@sdk-it/core';

import { TypeScriptDeserialzer } from './emitters/interface.ts';
import { ZodDeserialzer } from './emitters/zod.ts';
import {
  type Operation,
  type OperationInput,
  type Parser,
  type Spec,
  generateSDK,
} from './sdk.ts';
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

const statusCdeToMessageMap: Record<string, string> = {
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

export function generateCode(
  config: GenerateSdkConfig & {
    /**
     * No support for jsdoc in vscode
     * @issue https://github.com/microsoft/TypeScript/issues/38106
     */
    style?: 'github';
    makeImport: (module: string) => string;
  },
) {
  const commonSchemas: Record<string, string> = {};
  const commonZod = new Map<string, string>();
  const commonZodImports: Import[] = [];
  const zodDeserialzer = new ZodDeserialzer(config.spec, (model, schema) => {
    commonZod.set(model, schema);
    commonZodImports.push({
      defaultImport: undefined,
      isTypeOnly: true,
      moduleSpecifier: `./${config.makeImport(model)}`,
      namedImports: [{ isTypeOnly: true, name: model }],
      namespaceImport: undefined,
    });
  });

  const groups: Spec['operations'] = {};
  const outputs: Record<string, string> = {};

  forEachOperation(config, (entry, operation) => {
    console.log(`Processing ${entry.method} ${entry.path}`);
    const [groupName] = Array.isArray(operation.tags)
      ? operation.tags
      : ['unknown'];
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
    const securitySchemes = config.spec.components?.securitySchemes ?? {};

    const securityOptions = securityToOptions(security, securitySchemes);

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
    let outgoingContentType: string | undefined;
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

        Object.assign(inputs, bodyInputs(config, ctSchema));
        types[shortContenTypeMap[type]] = zodDeserialzer.handle(schema, true);
      }

      if (content['application/json']) {
        outgoingContentType = 'json';
      } else if (content['application/x-www-form-urlencoded']) {
        outgoingContentType = 'urlencoded';
      } else if (content['multipart/form-data']) {
        outgoingContentType = 'formdata';
      } else {
        outgoingContentType = 'json';
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

    const output = [`import z from 'zod';`];
    let parser: Parser = 'buffered';
    const responses: string[] = [];
    const responsesImports: Record<string, Import> = {};
    for (const status in operation.responses) {
      const typeScriptDeserialzer = new TypeScriptDeserialzer(
        config.spec,
        (schemaName, zod) => {
          commonSchemas[schemaName] = zod;
          responsesImports[schemaName] = {
            defaultImport: undefined,
            isTypeOnly: true,
            moduleSpecifier: `../models/${config.makeImport(schemaName)}`,
            namedImports: [{ isTypeOnly: true, name: schemaName }],
            namespaceImport: undefined,
          };
        },
      );
      const response = isRef(
        operation.responses[status] as ResponseObject | ReferenceObject,
      )
        ? (followRef(
            config.spec,
            operation.responses[status].$ref,
          ) as ResponseObject)
        : (operation.responses[status] as ResponseObject);
      const statusCode = +status;
      if (statusCode >= 400) {
        const responseContent = get(response, ['content']);
        const isJson = responseContent && responseContent['application/json'];
        const responseSchema = isJson
          ? typeScriptDeserialzer.handle(
              responseContent['application/json'].schema!,
              true,
            )
          : 'void';
        errors.push(
          statusCdeToMessageMap[status]
            ? `${statusCdeToMessageMap[status]}<${responseSchema}>`
            : 'ProblematicResponse',
        );
      } else if (statusCode >= 200 && statusCode < 300) {
        const responseContent = get(response, ['content']);
        const isJson = responseContent && responseContent['application/json'];
        if ((response.headers ?? {})['Transfer-Encoding']) {
          parser = 'chunked';
        }

        const responseSchema = isJson
          ? typeScriptDeserialzer.handle(
              responseContent['application/json'].schema!,
              true,
            )
          : statusCode === 204
            ? 'void'
            : 'ReadableStream'; // non-json response treated as stream

        responses.push(responseSchema);
      }
    }

    if (responses.length) {
      if (responses.length > 1) {
        // remove duplicates in case an operation has multiple responses with the same schema
        output.push(
          `export type ${pascalcase(entry.name + ' output')} = ${removeDuplicates(
            responses,
            (it) => it,
          ).join(' | ')};`,
        );
      } else {
        output.push(
          `export type ${pascalcase(entry.name + ' output')} = ${responses[0]};`,
        );
      }
    } else {
      output.push(`export type ${pascalcase(entry.name + ' output')} = void;`);
    }

    output.push(
      ...useImports(output.join(''), Object.values(responsesImports)),
    );

    outputs[`${spinalcase(entry.name)}.ts`] = output.join('\n');
    groups[groupName].push({
      name: entry.name,
      type: 'http',
      inputs,
      errors: errors.length ? errors : ['ServerError'],
      outgoingContentType,
      schemas: types,
      parser,
      formatOutput: () => ({
        import: pascalcase(entry.name + ' output'),
        use: pascalcase(entry.name + ' output'),
      }),
      trigger: entry,
    });
  });
  const clientFiles = generateSDK({
    operations: groups,
    makeImport: config.makeImport,
  });
  return { groups, commonSchemas, commonZod, outputs, clientFiles };
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

function toProps(
  spec: OpenAPIObject,
  schemaOrRef: SchemaObject | ReferenceObject,
  aggregator: string[] = [],
) {
  if (isRef(schemaOrRef)) {
    const schema = followRef(spec, schemaOrRef.$ref);
    return toProps(spec, schema, aggregator);
  } else if (schemaOrRef.type === 'object') {
    for (const [name] of Object.entries(schemaOrRef.properties ?? {})) {
      aggregator.push(name);
    }
    return void 0;
  } else if (
    (schemaOrRef.type === 'array' || schemaOrRef.type?.includes('array')) &&
    schemaOrRef.items
  ) {
    toProps(spec, schemaOrRef.items, aggregator);
    return void 0;
  } else if (schemaOrRef.allOf) {
    for (const it of schemaOrRef.allOf) {
      toProps(spec, it, aggregator);
    }
    return void 0;
  } else if (schemaOrRef.oneOf) {
    for (const it of schemaOrRef.oneOf) {
      toProps(spec, it, aggregator);
    }
    return void 0;
  } else if (schemaOrRef.anyOf) {
    for (const it of schemaOrRef.anyOf) {
      toProps(spec, it, aggregator);
    }
    return void 0;
  }
  console.warn('Unknown schema in body', schemaOrRef);
  return void 0;
}

function bodyInputs(
  config: GenerateSdkConfig,
  ctSchema: SchemaObject | ReferenceObject,
) {
  const props: string[] = [];
  toProps(config.spec, ctSchema, props);
  return props.reduce<Record<string, OperationInput>>(
    (acc, prop) => ({
      ...acc,
      [prop]: {
        in: 'body',
        schema: '',
      },
    }),
    {},
  );
}
