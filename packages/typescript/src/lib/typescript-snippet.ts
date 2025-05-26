import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';
import { camelcase, spinalcase } from 'stringcase';

import { followRef, isEmpty, isRef, pascalcase } from '@sdk-it/core';
import {
  type OperationEntry,
  type TunedOperationObject,
  patchParameters,
} from '@sdk-it/spec/operation.js';

import { SnippetEmitter } from './emitters/snippet.ts';
import type { TypeScriptGeneratorOptions } from './options.ts';

export class TypeScriptGenerator {
  #spec: OpenAPIObject;
  #settings: TypeScriptGeneratorOptions;
  #snippetEmitter: SnippetEmitter;
  #clientName: string;
  #packageName: string;
  constructor(spec: OpenAPIObject, settings: TypeScriptGeneratorOptions) {
    this.#spec = spec;
    this.#settings = settings;
    this.#snippetEmitter = new SnippetEmitter(spec);
    this.#clientName = settings.name?.trim()
      ? pascalcase(settings.name)
      : 'Client';

    this.#packageName = settings.name
      ? `@${spinalcase(this.#clientName.toLowerCase())}/sdk`
      : 'sdk';
  }

  succinct(
    entry: OperationEntry,
    operation: TunedOperationObject,
    values: {
      requestBody?: Record<string, unknown>;
      pathParameters?: Record<string, unknown>;
      queryParameters?: Record<string, unknown>;
      headers?: Record<string, unknown>;
      cookies?: Record<string, unknown>;
    },
  ) {
    let payload = '{}';
    if (!isEmpty(operation.requestBody)) {
      const contentTypes = Object.keys(operation.requestBody.content || {});
      if (contentTypes.length > 0) {
        const firstContent = operation.requestBody.content[contentTypes[0]];
        let schema = isRef(firstContent.schema)
          ? followRef(this.#spec, firstContent.schema.$ref)
          : firstContent.schema;
        if (schema) {
          if (schema.type !== 'object') {
            schema = {
              type: 'object',
              required: [operation.requestBody.required ? '$body' : ''],
              properties: {
                $body: schema,
              },
            };
          }
          const properties: Record<string, SchemaObject> = {};
          patchParameters(
            this.#spec,
            { type: 'object', properties },
            operation,
          );
          const examplePayload = this.#snippetEmitter.handle({
            ...schema,
            properties: Object.assign({}, properties, schema.properties),
          });
          // merge explicit values into the example payload
          Object.assign(
            examplePayload as any,
            values.requestBody ?? {},
            values.pathParameters ?? {},
            values.queryParameters ?? {},
            values.headers ?? {},
            values.cookies ?? {},
          );
          payload = JSON.stringify(examplePayload, null, 2);
        }
      }
    } else {
      const properties: Record<string, SchemaObject> = {};
      patchParameters(this.#spec, { type: 'object', properties }, operation);
      const examplePayload = this.#snippetEmitter.handle({
        properties: properties,
      });
      // merge explicit values into the example payload
      Object.assign(
        examplePayload as any,
        values.pathParameters ?? {},
        values.queryParameters ?? {},
        values.headers ?? {},
        values.cookies ?? {},
      );
      payload = JSON.stringify(examplePayload, null, 2);
    }
    return `const result = await ${camelcase(this.#clientName)}.request('${entry.method.toUpperCase()} ${entry.path}', ${payload});`;
  }
  snippet(
    entry: OperationEntry,
    operation: TunedOperationObject,
    config: Record<string, unknown> = {},
  ) {
    const payload = this.succinct(entry, operation, {});
    const content: string[] = [
      this.client(),
      '',
      payload,
      '',
      `console.log(result.data);`,
    ];
    if (config.frame) {
      content.unshift('```typescript');
      content.push('```');
    }
    return content.join('\n');
  }

  client() {
    return `import { ${this.#clientName} } from '${this.#packageName}';

const ${camelcase(this.#clientName)} = new ${this.#clientName}({
  baseUrl: '${this.#spec.servers?.[0]?.url ?? 'http://localhost:3000'}',
});`;
  }
}

export function generateSnippet(
  spec: OpenAPIObject,
  settings: TypeScriptGeneratorOptions,
  entry: OperationEntry,
  operation: TunedOperationObject,
  config: Record<string, unknown> = {},
): string {
  const generator = new TypeScriptGenerator(spec, settings);
  return generator.snippet(entry, operation, config);
}
