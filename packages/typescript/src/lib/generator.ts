import { merge, template } from 'lodash-es';
import { join } from 'node:path';
import type {
  OpenAPIObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { camelcase, spinalcase } from 'stringcase';

import { followRef, isEmpty, isRef, resolveRef } from '@sdk-it/core';
import {
  type OurOpenAPIObject,
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec';

import { ZodEmitter } from './emitters/zod.ts';
import { type OperationInput, type Spec, toEndpoint } from './sdk.ts';
import type { Style } from './style.ts';
import endpointsTxt from './styles/github/endpoints.txt';

function coearceRequestInput(
  spec: OurOpenAPIObject,
  operation: TunedOperationObject,
  type: string,
) {
  let objectSchema = resolveRef(
    spec,
    operation.requestBody.content[type].schema,
  );
  const xProperties: Record<string, SchemaObject> =
    objectSchema['x-properties'] ?? {};
  const xRequired: string[] = objectSchema['x-required'] ?? [];

  if (type === 'application/empty') {
    // if empty body and not params then we need to set it to object with additional properties
    // to avoid unknown input ts errors.
    objectSchema = {
      type: 'object',
      additionalProperties: isEmpty(xProperties),
    };
  } else {
    if (objectSchema.type !== 'object') {
      objectSchema = {
        type: 'object',
        required: [operation.requestBody.required ? '$body' : ''],
        properties: {
          $body: objectSchema,
        },
      };
    }
  }
  return {
    objectSchema,
    xProperties,
    xRequired,
  };
}
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

export function generateCode(config: {
  /**
   * No support for jsdoc in vscode
   * @issue https://github.com/microsoft/TypeScript/issues/38106
   */
  spec: OurOpenAPIObject;
  style: Style;
  makeImport: (module: string) => string;
}) {
  const commonZod = new Map<string, string>();
  const commonZodImports: Import[] = [];
  const zodDeserialzer = new ZodEmitter(config.spec, (model, schema) => {
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
  const endpoints: Record<string, ReturnType<typeof toEndpoint>[]> = {};

  forEachOperation(config.spec, (entry, operation) => {
    console.log(`Processing ${entry.method} ${entry.path}`);
    groups[entry.tag] ??= [];
    endpoints[entry.tag] ??= [];
    const schemas: Record<string, string> = {};
    const shortContenTypeMap: Record<string, string> = {
      'application/json': 'json',
      'application/*+json': 'json', // type specific of json like application/vnd.api+json (from the generation pov it shouldn't matter)
      'text/json': 'json', // non standard - later standardized to application/json
      'application/x-www-form-urlencoded': 'urlencoded',
      'multipart/form-data': 'formdata',
      'application/xml': 'xml',
      'text/plain': 'text',
    };

    for (const type in operation.requestBody.content) {
      const { objectSchema, xProperties, xRequired } = coearceRequestInput(
        config.spec,
        operation,
        type,
      );
      const additionalProperties: Record<string, ParameterObject> = {};
      for (const [name, prop] of Object.entries(xProperties)) {
        additionalProperties[name] = {
          name: name,
          required: xRequired?.includes(name),
          schema: prop,
          in: prop['x-in'],
        };
      }

      const schema = merge({}, objectSchema, {
        required: Object.values(additionalProperties)
          .filter((p) => p.required)
          .map((p) => p.name),
        properties: Object.entries(additionalProperties).reduce(
          (acc, [, p]) => ({ ...acc, [p.name]: p.schema }),
          {},
        ),
      });

      schemas[shortContenTypeMap[type]] = zodDeserialzer.handle(schema, true);
    }
    const details = buildInput(config.spec, operation);
    const endpoint = toEndpoint(
      entry.tag,
      config.spec,
      operation,
      {
        method: entry.method,
        path: entry.path,
        operationId: operation.operationId,
        schemas,
        outgoingContentType: details.outgoingContentType,
        inputs: details.inputs,
      },
      config,
    );

    endpoints[entry.tag].push(endpoint);

    groups[entry.tag].push({
      method: entry.method,
      path: entry.path,
      operationId: operation.operationId,
      schemas,
      outgoingContentType: details.outgoingContentType,
      inputs: details.inputs,
    });
  });
  const allSchemas = Object.keys(endpoints).map((it) => ({
    import: `import ${camelcase(it)} from './${config.makeImport(spinalcase(it))}';`,
    use: `  ...${camelcase(it)}`,
  }));

  return {
    groups,
    commonZod,
    endpoints: {
      [join('api', 'endpoints.ts')]: `


import type z from 'zod';
import type { ParseError } from '${config.makeImport('../http/parser')}';
import type { ProblematicResponse, SuccessfulResponse } from '${config.makeImport(
        '../http/response',
      )}';

import schemas from '${config.makeImport('./schemas')}';
import type { Unionize } from '${config.makeImport('../http/dispatcher')}';
      ${template(endpointsTxt)({ outputType: config.style?.outputType })}`,
      [`${join('api', 'schemas.ts')}`]:
        `${allSchemas.map((it) => it.import).join('\n')}
import { KIND } from "${config.makeImport('../http/index')}";
export default {\n${allSchemas.map((it) => it.use).join(',\n')}\n};

`.trim(),
      ...Object.fromEntries(
        Object.entries(endpoints)
          .map(([name, endpoint]) => {
            return [
              [
                join('api', `${spinalcase(name)}.ts`),
                `${[
                  `import z from 'zod';`,
                  `import * as http from '${config.makeImport('../http/response')}';`,
                  `import * as outputs from '${config.makeImport('../outputs/index')}';`,
                  `import { toRequest, json, urlencoded, empty, formdata, createUrl, type HeadersInit } from '${config.makeImport('../http/request')}';`,
                  `import { chunked, buffered } from "${config.makeImport('../http/parse-response')}";`,
                  `import * as ${camelcase(name)} from '../inputs/${config.makeImport(spinalcase(name))}';`,
                  `import { createBaseUrlInterceptor, createHeadersInterceptor, type Interceptor } from '${config.makeImport('../http/interceptors')}';`,
                  `import { Dispatcher, fetchType, type InstanceType } from '${config.makeImport('../http/dispatcher')}';`,
                  `import { Pagination, OffsetPagination, CursorPagination } from "${config.makeImport('../pagination/index')}";`,
                ].join(
                  '\n',
                )}\nexport default {\n${endpoint.flatMap((it) => it.schemas).join(',\n')}\n}`,
              ],
            ];
          })
          .flat(),
      ),
    },
  };
}

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
  spec: OurOpenAPIObject,
  ctSchema: SchemaObject | ReferenceObject,
) {
  const props: string[] = [];
  toProps(spec, ctSchema, props);
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

const contentTypeMap = {
  'application/json': 'json',
  'application/x-www-form-urlencoded': 'urlencoded',
  'multipart/form-data': 'formdata',
  'application/xml': 'xml',
  'text/plain': 'text',
  'application/empty': 'empty',
} as const;

export function buildInput(
  spec: OurOpenAPIObject,
  operation: TunedOperationObject,
) {
  const inputs: Record<string, OperationInput> = {};

  let outgoingContentType: (typeof contentTypeMap)[keyof typeof contentTypeMap] =
    'empty';

  for (const [ct, value] of Object.entries(contentTypeMap)) {
    if (operation.requestBody.content[ct]) {
      outgoingContentType = value;
      const { objectSchema, xProperties } = coearceRequestInput(
        spec,
        operation,
        ct,
      );
      for (const [name, prop] of Object.entries(xProperties)) {
        inputs[name] = {
          in: prop['x-in'],
          schema: '',
        };
      }

      Object.assign(inputs, bodyInputs(spec, objectSchema));
      break;
    }
  }
  return {
    inputs,
    outgoingContentType,
  };
}
