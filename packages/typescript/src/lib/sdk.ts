import { camelcase, pascalcase, spinalcase } from 'stringcase';

import { removeDuplicates, toLitObject } from '@sdk-it/core';

import backend from './client.ts';

class SchemaEndpoint {
  #imports: string[] = [
    `import z from 'zod';`,
    'import type { Endpoints } from "./endpoints.ts";',
    `import { toRequest, json, urlencoded, nobody, formdata, createUrl } from './http/request.ts';`,
    `import type { ParseError } from './http/parser.ts';`,
  ];
  #endpoints: string[] = [];
  addEndpoint(endpoint: string, operation: any) {
    this.#endpoints.push(`  "${endpoint}": ${operation},`);
  }
  addImport(value: string) {
    this.#imports.push(value);
  }
  complete() {
    return `${this.#imports.join('\n')}\nexport default {\n${this.#endpoints.join('\n')}\n}`;
  }
}
class Emitter {
  protected imports: string[] = [
    `import z from 'zod';`,
    `import type { ParseError } from './http/parser.ts';`,
  ];
  protected endpoints: string[] = [];
  addEndpoint(endpoint: string, operation: any) {
    this.endpoints.push(`  "${endpoint}": ${operation};`);
  }
  addImport(value: string) {
    this.imports.push(value);
  }
  complete() {
    return `${this.imports.join('\n')}\nexport interface Endpoints {\n${this.endpoints.join('\n')}\n}`;
  }
}
class StreamEmitter extends Emitter {
  override complete() {
    return `${this.imports.join('\n')}\nexport interface StreamEndpoints {\n${this.endpoints.join('\n')}\n}`;
  }
}

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
  operations: Record<string, Operation[]>;
  commonZod?: string;
  name: string;
  options: Options;
  servers: string[];
}

export interface OperationInput {
  in: string;
  schema: string;
}
export interface Operation {
  name: string;
  errors: string[];
  type: string;
  trigger: Record<string, any>;
  contentType?: string;
  schemas: Record<string, string>;
  schema?: string;
  inputs: Record<string, OperationInput>;
  formatOutput: () => { import: string; use: string };
}

export function generateClientSdk(spec: Spec) {
  const emitter = new Emitter();
  const streamEmitter = new StreamEmitter();
  const schemas: Record<string, string[]> = {};
  const schemaEndpoint = new SchemaEndpoint();
  const errors: string[] = [];
  for (const [name, operations] of Object.entries(spec.operations)) {
    const featureSchemaFileName = camelcase(name);
    schemas[featureSchemaFileName] = [`import z from 'zod';`];
    emitter.addImport(
      `import * as ${featureSchemaFileName} from './inputs/${featureSchemaFileName}.ts';`,
    );
    streamEmitter.addImport(
      `import * as ${featureSchemaFileName} from './inputs/${featureSchemaFileName}.ts';`,
    );
    schemaEndpoint.addImport(
      `import * as ${featureSchemaFileName} from './inputs/${featureSchemaFileName}.ts';`,
    );
    for (const operation of operations) {
      const schemaName = camelcase(`${operation.name} schema`);

      const schema = `export const ${schemaName} = ${
        Object.keys(operation.schemas).length === 1
          ? Object.values(operation.schemas)[0]
          : toLitObject(operation.schemas)
      };`;

      schemas[featureSchemaFileName].push(schema);
      const schemaRef = `${featureSchemaFileName}.${schemaName}`;
      const output = operation.formatOutput();
      const inputHeaders: string[] = [];
      const inputQuery: string[] = [];
      const inputBody: string[] = [];
      const inputParams: string[] = [];
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
      if (operation.type === 'sse') {
        const input = `z.infer<typeof ${schemaRef}>`;
        const endpoint = `${operation.trigger.method.toUpperCase()} ${operation.trigger.path}`;
        streamEmitter.addImport(
          `import type {${pascalcase(operation.name)}} from './outputs/${spinalcase(operation.name)}.ts';`,
        );
        streamEmitter.addEndpoint(
          endpoint,
          `{input: ${input}, output: ${output.use}}`,
        );
        schemaEndpoint.addEndpoint(
          endpoint,
          `{
        schema: ${schemaRef},
        toRequest(input: StreamEndpoints['${endpoint}']['input'], init: {baseUrl:string; headers?: Partial<Record<string, string>>}) {
          const endpoint = '${endpoint}';
            return toRequest(endpoint, json(input, {
            inputHeaders: [${inputHeaders}],
            inputQuery: [${inputQuery}],
            inputBody: [${inputBody}],
            inputParams: [${inputParams}],
          }), init);
          },
        }`,
        );
      } else {
        emitter.addImport(
          `import type {${output.import}} from './outputs/${spinalcase(operation.name)}.ts';`,
        );
        errors.push(...(operation.errors ?? []));

        const addTypeParser = Object.keys(operation.schemas).length > 1;
        for (const type in operation.schemas ?? {}) {
          let typePrefix = '';
          if (addTypeParser && type !== 'json') {
            typePrefix = `${type} `;
          }
          const input = `typeof ${schemaRef}${addTypeParser ? `.${type}` : ''}`;

          const endpoint = `${typePrefix}${operation.trigger.method.toUpperCase()} ${operation.trigger.path}`;
          emitter.addEndpoint(
            endpoint,
            `{input: z.infer<${input}>; output: ${output.use}; error: ${(operation.errors ?? ['ServerError']).concat(`ParseError<${input}>`).join('|')}}`,
          );
          schemaEndpoint.addEndpoint(
            endpoint,
            `{
          schema: ${schemaRef}${addTypeParser ? `.${type}` : ''},
          toRequest(input: Endpoints['${endpoint}']['input'], init: {baseUrl:string; headers?: Partial<Record<string, string>>}) {
            const endpoint = '${endpoint}';
              return toRequest(endpoint, ${operation.contentType || 'nobody'}(input, {
              inputHeaders: [${inputHeaders}],
              inputQuery: [${inputQuery}],
              inputBody: [${inputBody}],
              inputParams: [${inputParams}],
            }), init);
            },
          }`,
          );
        }
      }
    }
  }

  emitter.addImport(
    `import type { ${removeDuplicates(errors, (it) => it).join(', ')} } from './http/response.ts';`,
  );
  return {
    ...Object.fromEntries(
      Object.entries(schemas).map(([key, value]) => [
        `inputs/${key}.ts`,
        [
          // schemasImports.length
          //   ? `import {${removeDuplicates(schemasImports, (it) => it)}} from '../zod';`
          //   : '',
          spec.commonZod ? 'import * as commonZod from "../zod.ts";' : '',
          ...value,
        ]
          .map((it) => it.trim())
          .filter(Boolean)
          .join('\n') + '\n', // add a newline at the end
      ]),
    ),
    'client.ts': backend(spec),
    'schemas.ts': schemaEndpoint.complete(),
    'endpoints.ts': emitter.complete(),
  };
}
