import { camelcase, spinalcase } from 'stringcase';

import { removeDuplicates, toLitObject } from '@sdk-it/core';

import backend from './client.ts';
import type { MakeImportFn } from './utils.ts';

export type Parser = 'chunked' | 'buffered';
class SchemaEndpoint {
  #makeImport: MakeImportFn;
  #imports: string[] = [];
  constructor(makeImport: MakeImportFn) {
    this.#makeImport = makeImport;
    this.#imports = [
      `import z from 'zod';`,
      `import type { Endpoints } from '${this.#makeImport('./endpoints')}';`,
      `import { toRequest, json, urlencoded, nobody, formdata, createUrl } from '${this.#makeImport('./http/request')}';`,
      `import type { ParseError } from '${this.#makeImport('./http/parser')}';`,
      `import { chunked, buffered } from "${this.#makeImport('./http/parse-response')}";`,
    ];
  }

  #endpoints: string[] = [];

  addEndpoint(endpoint: string, operation: string) {
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
  #makeImport: MakeImportFn;
  protected imports: string[] = [];
  constructor(makeImport: MakeImportFn) {
    this.#makeImport = makeImport;
    this.imports = [
      `import type z from 'zod';`,
      `import type { ParseError } from '${this.#makeImport('./http/parser')}';`,
    ];
  }
  protected endpoints: string[] = [];
  addEndpoint(endpoint: string, operation: string) {
    this.endpoints.push(`  "${endpoint}": ${operation};`);
  }
  addImport(value: string) {
    this.imports.push(value);
  }
  complete() {
    return `${this.imports.join('\n')}\nexport interface Endpoints {\n${this.endpoints.join('\n')}\n}`;
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
  makeImport: MakeImportFn;
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
  outgoingContentType?: string;
  parser: Parser;
  schemas: Record<string, string>;
  inputs: Record<string, OperationInput>;
  formatOutput: () => { import: string; use: string };
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

export function generateSDK(spec: Spec) {
  const emitter = new Emitter(spec.makeImport);
  const schemaEndpoint = new SchemaEndpoint(spec.makeImport);
  const errors: string[] = [];
  for (const [name, operations] of Object.entries(spec.operations)) {
    emitter.addImport(
      `import type * as ${camelcase(name)} from './inputs/${spec.makeImport(spinalcase(name))}';`,
    );
    schemaEndpoint.addImport(
      `import * as ${camelcase(name)} from './inputs/${spec.makeImport(spinalcase(name))}';`,
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
        `import type {${output.import}} from './outputs/${spec.makeImport(spinalcase(operation.name))}';`,
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
          deserializer: ${operation.parser === 'chunked' ? 'chunked' : 'buffered'},
          toRequest(input: Endpoints['${endpoint}']['input']) {
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
    }
  }

  emitter.addImport(
    `import type { ${removeDuplicates(errors, (it) => it).join(', ')} } from '${spec.makeImport('./http/response')}';`,
  );
  return {
    'client.ts': backend(spec),
    'schemas.ts': schemaEndpoint.complete(),
    'endpoints.ts': emitter.complete(),
  };
}
