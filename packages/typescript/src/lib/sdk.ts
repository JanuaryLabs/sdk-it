import { camelcase, spinalcase } from 'stringcase';

import { removeDuplicates, toLitObject } from '@sdk-it/core';

import backend from './client.ts';
import { exclude } from './utils.ts';

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

export function generateInputs(
  operationsSet: Spec['operations'],
  commonZod: Map<string, string>,
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
            `import { ${schema} } from './schemas/${spinalcase(schema)}.ts';`,
          );
        }
      }
      output.push(inputContent);
    }
    inputs[`inputs/${spinalcase(name)}.ts`] =
      [...imports, ...output].join('\n') + '\n';
  }
  return {
    ...Object.fromEntries(
      commonZod
        .entries()
        .map(([name, schema]) => [
          `inputs/schemas/${spinalcase(name)}.ts`,
          [
            `import { z } from 'zod';`,
            ...exclude(commonImports, [name]).map(
              (it) => `import { ${it} } from './${spinalcase(it)}.ts';`,
            ),
            `export const ${name} = ${schema};`,
          ].join('\n'),
        ]),
    ),
    ...inputs,
  };
}

export function generateSDK(spec: Spec) {
  const emitter = new Emitter();
  const schemaEndpoint = new SchemaEndpoint();
  const errors: string[] = [];
  for (const [name, operations] of Object.entries(spec.operations)) {
    emitter.addImport(
      `import * as ${camelcase(name)} from './inputs/${spinalcase(name)}.ts';`,
    );
    schemaEndpoint.addImport(
      `import * as ${camelcase(name)} from './inputs/${spinalcase(name)}.ts';`,
    );
    for (const operation of operations) {
      const schemaName = camelcase(`${operation.name} schema`);
      const schemaRef = `${camelcase(name)}.${schemaName}`;
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
          toRequest(input: Endpoints['${endpoint}']['input']) {
            const endpoint = '${endpoint}';
                return toRequest(endpoint, ${operation.contentType || 'nobody'}(input, {
                inputHeaders: [${inputHeaders}],
                inputQuery: [${inputQuery}],
                inputBody: [${inputBody}],
                inputParams: [${inputParams}],
              }));
            },
          }`,
        );
      }
    }
  }

  emitter.addImport(
    `import type { ${removeDuplicates(errors, (it) => it).join(', ')} } from './http/response.ts';`,
  );
  return {
    'client.ts': backend(spec),
    'schemas.ts': schemaEndpoint.complete(),
    'endpoints.ts': emitter.complete(),
  };
}
