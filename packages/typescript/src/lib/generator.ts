import { get, merge } from 'lodash-es';
import { join } from 'node:path';
import type {
  ContentObject,
  OpenAPIObject,
  ParameterLocation,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { camelcase, pascalcase, spinalcase } from 'stringcase';

import { followRef, isRef } from '@sdk-it/core';
import {
  type GenerateSdkConfig,
  forEachOperation,
} from '@sdk-it/spec/operation.js';

import { ZodDeserialzer } from './emitters/zod.ts';
import {
  type Operation,
  type OperationInput,
  type Spec,
  toEndpoint,
} from './sdk.ts';
import {
  importsToString,
  mergeImports,
  securityToOptions,
  useImports,
} from './utils.ts';

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
  const endpoints: Record<string, ReturnType<typeof toEndpoint>[]> = {};

  forEachOperation(config, (entry, operation) => {
    console.log(`Processing ${entry.method} ${entry.path}`);

    groups[entry.groupName] ??= [];
    endpoints[entry.groupName] ??= [];
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

    const schemas: Record<string, string> = {};
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
        schemas[shortContenTypeMap[type]] = zodDeserialzer.handle(schema, true);
      }

      // TODO: each content type should create own endpoint or force content-type header to be set as third parameter
      // we can do the same for response that have multiple content types: force accept header to be set as third parameter
      // instead of prefixing the endpoint name with the content type
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
      schemas[shortContenTypeMap['application/json']] = zodDeserialzer.handle(
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

    const endpoint = toEndpoint(
      entry.groupName,
      config.spec,
      operation,
      {
        outgoingContentType,
        name: operation.operationId,
        type: 'http',
        trigger: entry,
        schemas,
        inputs,
      },
      { makeImport: config.makeImport },
    );

    const output = [`import z from 'zod';`];
    const responses = endpoint.responses.flatMap((it) => it.responses);
    const responsesImports = endpoint.responses.flatMap((it) =>
      Object.values(it.imports),
    );
    if (responses.length) {
      output.push(
        ...responses.map((it) => `export type ${it.name} = ${it.schema};`),
      );
    } else {
      output.push(
        `export type ${pascalcase(operation.operationId + ' output')} = void;`,
      );
    }

    output.unshift(...useImports(output.join(''), ...responsesImports));

    outputs[`${spinalcase(operation.operationId)}.ts`] = output.join('\n');

    endpoints[entry.groupName].push(endpoint);

    groups[entry.groupName].push({
      name: operation.operationId,
      type: 'http',
      inputs,
      outgoingContentType,
      schemas,
      trigger: entry,
    });
  });
  const commonSchemas = Object.values(endpoints).reduce<Record<string, string>>(
    (acc, endpoint) => ({
      ...acc,
      ...endpoint.reduce<Record<string, string>>(
        (acc, { responses }) => ({
          ...acc,
          ...responses.reduce<Record<string, string>>(
            (acc, it) => ({ ...acc, ...it.schemas }),
            {},
          ),
        }),
        {},
      ),
    }),
    {},
  );

  const allSchemas = Object.keys(endpoints).map((it) => ({
    import: `import ${camelcase(it)} from './${config.makeImport(spinalcase(it))}';`,
    use: `  ...${camelcase(it)}`,
  }));

  const imports = [
    'import z from "zod";',
    `import type { ParseError } from '${config.makeImport('../http/parser')}';`,
    `import type { ServerError } from '${config.makeImport('../http/response')}';`,
    `import type { OutputType, Parser, Type } from '../http/send-request.ts';`,
  ];
  return {
    groups,
    commonSchemas,
    commonZod,
    outputs,
    endpoints: {
      [`${join('api', 'schemas.ts')}`]: `
${imports.join('\n')}
${allSchemas.map((it) => it.import).join('\n')}

const schemas = {\n${allSchemas.map((it) => it.use).join(',\n')}\n};


type Output<T extends OutputType> = T extends {
  parser: Parser;
  type: Type<any>;
}
  ? InstanceType<T['type']>
  : T extends Type<any>
    ? InstanceType<T>
    : never;

export type Endpoints = {
  [K in keyof typeof schemas]: {
    input: z.infer<(typeof schemas)[K]['schema']>;
    output: (typeof schemas)[K]['output'] extends [
      infer Single extends OutputType,
    ]
      ? Output<Single>
      : (typeof schemas)[K]['output'] extends readonly [
            ...infer Tuple extends OutputType[],
          ]
        ? { [I in keyof Tuple]: Output<Tuple[I]> }[number]
        : never;
    error: ServerError | ParseError<(typeof schemas)[K]['schema']>;
  };
};

export default schemas;


`.trim(),
      ...Object.fromEntries(
        Object.entries(endpoints)
          .map(([name, endpoint]) => {
            const imps = importsToString(
              ...mergeImports(
                ...endpoint.flatMap((it) =>
                  it.responses.flatMap((it) =>
                    Object.values(it.endpointImports),
                  ),
                ),
              ),
            );
            // const imports = endpoint.map((it) => it.imports).flat();
            return [
              [
                join('api', `${spinalcase(name)}.ts`),
                `${[
                  ...imps,
                  // ...imports,
                  `import z from 'zod';`,
                  `import { toRequest, json, urlencoded, nobody, formdata, createUrl } from '${config.makeImport('../http/request')}';`,
                  `import { chunked, buffered } from "${config.makeImport('../http/parse-response')}";`,
                  `import * as ${camelcase(name)} from '../inputs/${config.makeImport(spinalcase(name))}';`,
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
