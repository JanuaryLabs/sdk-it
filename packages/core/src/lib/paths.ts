import type {
  HeadersObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { $types } from './deriver.js';
import { sortArray } from './utils.js';
import { type InjectImport, evalZod } from './zod-jsonschema.js';

export type OperationInfo = {
  tool?: string;
  toolDescription?: string;
  summary?: string;
  description?: string;
  tags?: string[];
};
export type Method =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'trace'
  | 'head';

export const methods = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'trace',
  'head',
] as const;
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
  against: string;
  source: SemanticSource;
}

export interface ResponseItem {
  statusCode: string;
  response?: DateType;
  contentType: string;
  headers: (string | Record<string, string[]>)[];
}

export type OnOperation = (
  sourceFile: string,
  method: Method,
  path: string,
  operation: OperationObject,
) => PathsObject;
export class Paths {
  #imports: InjectImport[] = [];
  #onOperation?: OnOperation;
  #operations: Array<{
    sourceFile: string;
    name: string;
    path: string;
    method: Method;
    selectors: Selector[];
    responses: ResponsesObject;
    contentType?: string;
    info: OperationInfo;
  }> = [];

  constructor(config: { imports: InjectImport[]; onOperation?: OnOperation }) {
    this.#imports = config.imports;
    this.#onOperation = config.onOperation;
  }

  addPath(
    name: string,
    path: string,
    method: Method,
    contentType: string | undefined,
    selectors: Selector[],
    responses: ResponseItem[],
    sourceFile: string,
    info: OperationInfo,
  ) {
    const responsesObject = this.#responseItemToResponses(responses);

    this.#operations.push({
      name,
      path: this.#tunePath(path),
      sourceFile,
      contentType: contentType,
      method,
      selectors,
      responses: responsesObject,
      info,
    });
    return this;
  }

  #responseItemToResponses(responses: ResponseItem[]): ResponsesObject {
    const responsesObject: ResponsesObject = {};
    for (const item of responses) {
      const ct = item.contentType;
      const schema = item.response ? toSchema(item.response) : {};
      if (!responsesObject[item.statusCode]) {
        responsesObject[item.statusCode] = {
          description: `Response for ${item.statusCode}`,
          content:
            ct !== 'empty'
              ? {
                  [ct]:
                    ct === 'application/octet-stream'
                      ? { schema: { type: 'string', format: 'binary' } }
                      : { schema },
                }
              : undefined,
          headers: item.headers.length
            ? item.headers.reduce<HeadersObject>((acc, current) => {
                const headers =
                  typeof current === 'string' ? { [current]: [] } : current;
                const sortedHeaders = Object.entries(headers).sort(([a], [b]) =>
                  a.localeCompare(b),
                );
                return sortedHeaders.reduce<HeadersObject>(
                  (subAcc, [key, value]) => {
                    const header: HeadersObject = {
                      [key]: {
                        schema: {
                          type: 'string',
                          enum: value.length ? value : undefined,
                        },
                      },
                    };
                    return { ...subAcc, ...header };
                  },
                  acc,
                );
              }, {})
            : undefined,
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
    const bodySchemaProps: Record<
      string,
      { required: boolean; schema: SchemaObject }
    > = {};
    for (const selector of selectors) {
      const { optional, schema } = await evalZod(
        selector.against,
        this.#imports,
      );
      if (selector.source === 'body') {
        bodySchemaProps[selector.name] = {
          required: !optional,
          schema,
        };
        continue;
      }
      const parameter: ParameterObject = {
        in: semanticSourceToOpenAPI[selector.source],
        name: selector.name,
        required: !optional,
        schema,
      };
      parameters.push(parameter);
    }
    return { parameters, bodySchemaProps };
  }

  getTags(): string[] {
    const tags = new Set<string>();

    for (const operation of this.#operations) {
      if (operation.info.tags) {
        for (const tag of operation.info.tags) {
          tags.add(tag);
        }
      }
    }

    return Array.from(tags);
  }

  async getPaths() {
    const operations: PathsObject = {};

    for (const operation of this.#operations) {
      const { path, method, selectors } = operation;
      const { parameters, bodySchemaProps } =
        await this.#selectosToParameters(selectors);
      const bodySchema: Record<string, SchemaObject> = {};
      const required: string[] = [];
      const sortedBodySchemaProps = Object.entries(bodySchemaProps).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      for (const [key, value] of sortedBodySchemaProps) {
        if (value.required) {
          required.push(key);
        }
        bodySchema[key] = value.schema;
      }

      const operationObject: OperationObject = {
        operationId: operation.name,
        parameters,
        tags: operation.info.tags,
        // || undefined would omit the value from final openapi spec
        description: operation.info.description || undefined,
        summary: operation.info.summary || undefined,
        'x-tool': operation.info.tool
          ? {
              name: operation.info.tool || undefined,
              description: operation.info.toolDescription || undefined,
            }
          : undefined,
        requestBody: Object.keys(bodySchema).length
          ? {
              required: required.length ? true : false,
              content: {
                [operation.contentType || 'application/json']: {
                  schema: {
                    required: required.length ? sortArray(required) : undefined,
                    type: 'object',
                    properties: bodySchema,
                  },
                },
              },
            }
          : undefined,
        responses:
          Object.keys(operation.responses).length === 0
            ? undefined
            : operation.responses,
      };
      if (!operations[path]) {
        operations[path] = {};
      }
      operations[path][method] = operationObject;
      if (this.#onOperation) {
        const paths = this.#onOperation?.(
          operation.sourceFile,
          method,
          path,
          operationObject,
        );
        Object.assign(operations, paths ?? {});
      }
    }
    return operations;
  }

  /**
   * Converts Express/Node.js style path parameters (/path/:param) to OpenAPI style (/path/{param})
   */
  #tunePath(path: string): string {
    return path.replace(/:([^/]+)/g, '{$1}');
  }
}

interface DateType {
  [$types]: any[];
  kind: string;
  optional: boolean;
  value?: string;
}

export function toSchema(data: DateType | string | null | undefined): any {
  if (data === null || data === undefined) {
    return { type: 'any' };
  } else if (typeof data === 'string') {
    const isRef = data.startsWith('#');
    if (isRef) {
      return { $ref: data };
    }
    return { type: data };
  } else if (data.kind === 'literal') {
    return { enum: [data.value], type: data[$types][0] };
  } else if (data.kind === 'record') {
    return {
      type: 'object',
      additionalProperties: toSchema(data[$types][0]),
    };
  } else if (data.kind === 'array') {
    const items = data[$types].map(toSchema);
    return { type: 'array', items: data[$types].length ? items[0] : {} };
  } else if (data.kind === 'union') {
    return { anyOf: data[$types].map(toSchema) };
  } else if (data.kind === 'intersection') {
    return { allOf: data[$types].map(toSchema) };
  } else if ($types in data) {
    return data[$types].map(toSchema)[0] ?? {};
  } else {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    const sortedEntries = Object.entries(data).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [key, value] of sortedEntries) {
      props[key] = toSchema(value as any);
      if (!(value as any).optional) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties: props,
      required: sortArray(required),
      additionalProperties: false,
    };
  }
}

export function isHttpMethod(name: string): name is Method {
  return ['get', 'post', 'put', 'delete', 'patch'].includes(name);
}
