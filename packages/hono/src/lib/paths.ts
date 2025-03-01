import type {
  OperationObject,
  ParameterObject,
  PathsObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { $types } from '@lace/core';

export type SemanticSource =
  | 'query'
  | 'queries'
  | 'body'
  | 'params'
  | 'headers';

const semanticSourceToOpenAPI = {
  queries: 'query',
  query: 'query',
  headers: 'header',
  params: 'path',
} as const;
export interface Selector {
  name: string;
  select: string;
  against: string;
  source: SemanticSource;
  nullable: boolean;
  required: boolean;
}
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface ResponseItem {
  statusCode: string;
  response: DateType;
  contentType: string;
  headers: string[];
}

export class Paths {
  private operations: Array<{
    name: string;
    path: string;
    method: Method;
    selectors: Selector[];
    responses: ResponsesObject;
  }> = [];

  addPath(
    name: string,
    path: string,
    method: Method,
    selectors: Selector[],
    responses: ResponseItem[],
  ) {
    const responsesObject = this.#responseItemToResponses(responses);
    this.operations.push({
      name,
      path,
      method,
      selectors,
      responses: responsesObject,
    });
    return this;
  }

  #responseItemToResponses(responses: ResponseItem[]): ResponsesObject {
    const responsesObject: ResponsesObject = {};
    for (const item of responses) {
      const ct = item.contentType;
      const schema = toSchema(item.response);
      if (!responsesObject[item.statusCode]) {
        responsesObject[item.statusCode] = {
          description: `Response for ${item.statusCode}`,
          content: {
            [ct]:
              ct === 'application/octet-stream'
                ? { schema: { type: 'string', format: 'binary' } }
                : { schema },
          },
          headers: item.headers.reduce(
            (acc, header) => ({
              ...acc,
              [header]: { schema: { type: 'string' } },
            }),
            {},
          ),
        } satisfies ResponseObject;
      } else {
        if (!responsesObject[item.statusCode].content[ct]) {
          responsesObject[item.statusCode].content[ct] = { schema };
        } else {
          const existing = responsesObject[item.statusCode].content[ct]
            .schema as SchemaObject;
          if (existing.oneOf) {
            if (
              !existing.oneOf.find(
                (it) => JSON.stringify(it) === JSON.stringify(schema),
              )
            ) {
              existing.oneOf.push(schema);
            }
          } else if (JSON.stringify(existing) !== JSON.stringify(schema)) {
            responsesObject[item.statusCode].content[ct].schema = {
              oneOf: [existing, schema],
            };
          }
        }
      }
    }
    return responsesObject;
  }

  async #selectosToParameters(selectors: Selector[]) {
    const parameters: ParameterObject[] = [];
    const bodySchemaProps: Record<string, SchemaObject> = {};
    for (const selector of selectors) {
      if (selector.source === 'body') {
        bodySchemaProps[selector.name] = await evalZod(selector.against);
        continue;
      }
      const parameter: ParameterObject = {
        in: semanticSourceToOpenAPI[selector.source],
        name: selector.name,
        required: selector.required,
        schema: await evalZod(selector.against),
      };
      parameters.push(parameter);
    }
    return { parameters, bodySchemaProps };
  }

  async getPaths() {
    const operations: PathsObject = {};
    for (const operation of this.operations) {
      const { name, path, method, selectors } = operation;
      const { parameters, bodySchemaProps } =
        await this.#selectosToParameters(selectors);
      const operationObject: OperationObject = {
        operationId: name,
        parameters,
        requestBody: Object.keys(bodySchemaProps).length
          ? {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: bodySchemaProps,
                  },
                },
              },
            }
          : undefined,
        responses: operation.responses,
      };
      if (!operations[path]) {
        operations[path] = {};
      }
      operations[path][method] = operationObject;
    }
    return operations;
  }
}

async function evalZod(schema: string) {
  const lines = [
    `import { z } from 'zod';`,
    `import { zodToJsonSchema } from 'zod-to-json-schema';`,
    `const schema = ${schema.replace('.optional()', '')};`,
    `const jsonSchema = zodToJsonSchema(schema, {
			$refStrategy: 'root',
			basePath: ['#', 'components', 'schemas']
		});`,
    `export default jsonSchema;`,
  ];
  const base64Code = Buffer.from(lines.join('\n')).toString('base64');
  const dataUrl = `data:text/javascript;base64,${base64Code}`;
  return import(dataUrl)
    .then((mod) => mod.default)
    .then(({ $schema, ...result }) => result);
}

const typeMappings: Record<string, string> = {
  DateConstructor: 'Date',
};

interface DateType {
  [$types]: any[];
  kind: string;
  optional: boolean;
}

export function toSchema(data: DateType | string | null | undefined): any {
  if (data === null || data === undefined) {
    return { type: 'any' };
  } else if (typeof data === 'string') {
    const isRef = data.startsWith('#');
    if (isRef) {
      return { $ref: data };
    }
    return {
      type: `${typeMappings[data] || data}`,
    };
  } else if (data.kind === 'array') {
    const items = data[$types].map(toSchema);
    return { type: 'array', items: data[$types].length ? items[0] : {} };
  } else if (data.kind === 'union') {
    return { oneOf: data[$types].map(toSchema) };
  } else if ($types in data) {
    return data[$types].map(toSchema)[0] ?? {};
  } else {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      props[key] = toSchema(value as any);
    }
    return {
      type: 'object',
      properties: props,
      additionalProperties: false,
    };
  }
}
