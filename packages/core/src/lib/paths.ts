import type {
  HeadersObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  ReferenceObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { $types } from './derived-type.js';
import { isRef } from './ref.js';
import { sortArray, sortObjectKeys } from './utils.js';
import { type InjectImport, evalZod } from './zod-jsonschema.js';

export type OperationInfo = {
  tool?: string;
  toolDescription?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: SecurityRequirementObject[];
};
export type Method =
  'get' | 'post' | 'put' | 'patch' | 'delete' | 'trace' | 'head';

export const methods = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'trace',
  'head',
] as const;
const semanticSources = [
  'query',
  'queries',
  'body',
  'params',
  'headers',
] as const;
export type SemanticSource = (typeof semanticSources)[number];

const semanticSourceSet: ReadonlySet<string> = new Set(semanticSources);

export function isSemanticSource(value: string): value is SemanticSource {
  return semanticSourceSet.has(value);
}

const semanticSourceToOpenAPI = {
  queries: 'query',
  query: 'query',
  headers: 'header',
  params: 'path',
} as const;
/** A validator entry that selects one named value, such as `payload.params.id`. */
export interface FieldSelector {
  kind: 'field';
  source: SemanticSource;
  name: string;
  against: string;
}

/** A validator entry that selects the whole request body: `payload.body`. */
export interface BodySelector {
  kind: 'body';
  against: string;
}

export type Selector = FieldSelector | BodySelector;

interface RequestBody {
  required: boolean;
  schema: SchemaObject;
}

/** The object body a validator's body-field selections describe, if it selects any. */
function fieldsBody(
  fields: Record<string, RequestBody>,
): RequestBody | undefined {
  const entries = Object.entries(sortObjectKeys(fields));
  if (entries.length === 0) {
    return undefined;
  }
  const required = entries
    .filter(([, field]) => field.required)
    .map(([name]) => name);
  return {
    required: required.length > 0,
    schema: {
      required: required.length ? sortArray(required) : undefined,
      type: 'object',
      properties: Object.fromEntries(
        entries.map(([name, field]) => [name, field.schema]),
      ),
    },
  };
}

interface ResponseItemBase {
  statusCode: string;
  contentType: string;
  headers: (string | Record<string, string[]>)[];
  middlewareName?: string;
}

/** A response body is either derived from source or given as an OpenAPI schema, never both. */
export type ResponseItem = ResponseItemBase &
  (
    | { response?: DateType; schema?: never }
    | { schema: SchemaObject; response?: never }
  );

export type OnOperation = (
  sourceFile: string,
  method: Method,
  path: string,
  operation: OperationObject,
) => PathsObject;
export class Paths {
  #imports: InjectImport[] = [];
  #onOperation?: OnOperation;
  #sharedResponses = new Map<string, SchemaObject>();
  /** The schemas zod names with `.meta({ id })`, by id, across every operation. */
  #components = new Map<string, SchemaObject>();
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
    const responsesObject: Record<string, ResponseObject> = {};
    for (const item of responses) {
      const ct = item.contentType;
      let schema =
        item.schema ?? (item.response ? toSchema(item.response) : {});

      // Every route points at one shared schema per middleware, status and
      // content type; each distinct body the middleware sends joins its oneOf,
      // as the merge below does for one route's responses.
      if (item.middlewareName) {
        const sanitizedCt = ct.replace(/\//g, '_');
        const sharedKey = `${item.middlewareName}${item.statusCode}_${sanitizedCt}`;
        const shared = this.#sharedResponses.get(sharedKey);
        const incoming = JSON.stringify(schema);
        if (!shared) {
          this.#sharedResponses.set(sharedKey, schema);
        } else if (shared.oneOf) {
          if (!shared.oneOf.some((it) => JSON.stringify(it) === incoming)) {
            shared.oneOf.push(schema);
          }
        } else if (JSON.stringify(shared) !== incoming) {
          this.#sharedResponses.set(sharedKey, { oneOf: [shared, schema] });
        }
        schema = { $ref: `#/components/schemas/${sharedKey}` };
      }

      const contentSchema: SchemaObject | ReferenceObject =
        ct === 'application/octet-stream'
          ? { type: 'string', format: 'binary' }
          : schema;

      const existingResponse = responsesObject[item.statusCode];
      if (!existingResponse) {
        responsesObject[item.statusCode] = {
          description: `Response for ${item.statusCode}`,
          content:
            ct !== 'empty' ? { [ct]: { schema: contentSchema } } : undefined,
          headers: item.headers.length
            ? item.headers.reduce<HeadersObject>((acc, current) => {
                const headers =
                  typeof current === 'string' ? { [current]: [] } : current;
                const sortedHeaders = Object.entries(sortObjectKeys(headers));
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
        continue;
      }
      if (ct === 'empty') {
        continue;
      }
      existingResponse.content ??= {};
      const media = existingResponse.content[ct];
      if (!media) {
        existingResponse.content[ct] = { schema: contentSchema };
        continue;
      }
      const existing = media.schema;
      if (!existing) {
        media.schema = contentSchema;
        continue;
      }
      // Different bodies for one status and content type become a oneOf; the
      // shared middleware schemas above repeat this rule.
      const incoming = JSON.stringify(contentSchema);
      if (!isRef(existing) && existing.oneOf) {
        if (!existing.oneOf.some((it) => JSON.stringify(it) === incoming)) {
          existing.oneOf.push(contentSchema);
        }
      } else if (JSON.stringify(existing) !== incoming) {
        media.schema = { oneOf: [existing, contentSchema] };
      }
    }
    return responsesObject;
  }

  /** Converts a selector's zod schema, keeping the components it names. */
  async #evalSelector(selector: Selector, operation: string) {
    const site =
      selector.kind === 'field'
        ? `${operation} ${selector.source} field ${selector.name}`
        : `${operation} body`;
    let evaluated: {
      optional: boolean;
      schema: SchemaObject;
      components: Record<string, SchemaObject>;
    };
    try {
      evaluated = await evalZod(selector.against, this.#imports);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      throw new Error(`${site}: ${error.message}`, { cause: error });
    }
    for (const [id, component] of Object.entries(evaluated.components)) {
      const existing = this.#components.get(id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(component)) {
        throw new Error(
          `${site}: two different schemas share the id "${id}"; give each its own .meta({ id }).`,
        );
      }
      this.#components.set(id, component);
    }
    return evaluated;
  }

  async #selectosToParameters(selectors: Selector[], operation: string) {
    const parameters: ParameterObject[] = [];
    const bodyFields: Record<string, RequestBody> = {};
    let wholeBody: RequestBody | undefined;
    for (const selector of selectors) {
      const { optional, schema } = await this.#evalSelector(
        selector,
        operation,
      );
      if (selector.kind === 'body') {
        if (wholeBody) {
          throw new Error(`${operation} selects payload.body more than once.`);
        }
        wholeBody = { required: !optional, schema };
        continue;
      }
      if (selector.source === 'body') {
        bodyFields[selector.name] = {
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
    if (wholeBody && Object.keys(bodyFields).length > 0) {
      throw new Error(
        `${operation} selects both payload.body and body fields; select one or the other.`,
      );
    }
    return { parameters, body: wholeBody ?? fieldsBody(bodyFields) };
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

  /** The shared response schemas and every zod schema named with `.meta({ id })`; read it after {@link getPaths}, which converts them. */
  getSharedSchemas(): Record<string, SchemaObject> {
    return {
      ...Object.fromEntries(this.#sharedResponses),
      ...Object.fromEntries(this.#components),
    };
  }

  async getPaths() {
    const operations: PathsObject = {};

    for (const operation of this.#operations) {
      const { path, method, selectors } = operation;
      const { parameters, body } = await this.#selectosToParameters(
        selectors,
        `${method.toUpperCase()} ${path}`,
      );

      const operationObject: OperationObject = {
        operationId: operation.name,
        parameters,
        tags: operation.info.tags,
        // || undefined would omit the value from final openapi spec
        description: operation.info.description || undefined,
        summary: operation.info.summary || undefined,
        security: operation.info.security,
        'x-tool': operation.info.tool
          ? {
              name: operation.info.tool || undefined,
              description: operation.info.toolDescription || undefined,
            }
          : undefined,
        requestBody: body
          ? {
              required: body.required,
              content: {
                [operation.contentType || 'application/json']: {
                  schema: body.schema,
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

type DerivedProps = Record<string, DateType>;

function isDateType(data: DateType | DerivedProps): data is DateType {
  return $types in data;
}

export function toSchema(
  data: DateType | DerivedProps | string | null | undefined,
): any {
  if (data === null || data === undefined) {
    return { type: 'any' };
  } else if (typeof data === 'string') {
    const isRef = data.startsWith('#');
    if (isRef) {
      return { $ref: data };
    }
    return { type: data };
  } else if (!isDateType(data)) {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    const sortedEntries = Object.entries(sortObjectKeys(data));
    for (const [key, value] of sortedEntries) {
      props[key] = toSchema(value);
      if (!value.optional) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties: props,
      required: sortArray(required),
      additionalProperties: false,
    };
  } else if (data.kind === 'date') {
    return { type: 'string', format: 'date-time' };
  } else if (data.kind === 'never') {
    return { not: {} };
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
    const schemas = data[$types].map(toSchema);
    const unique = [
      ...new Map(
        schemas.map((schema) => [JSON.stringify(schema), schema]),
      ).values(),
    ];
    return unique.length === 1 ? unique[0] : { anyOf: unique };
  } else if (data.kind === 'intersection') {
    // An empty object (the `& {}` autocomplete-trick wrapper) adds no
    // constraint, so `(string & {})` emits as plain `{type:'string'}`.
    const meaningful = data[$types].filter(
      (m) =>
        !(
          m?.kind === 'object' &&
          m[$types].length === 1 &&
          Object.keys(m[$types][0]).length === 0
        ),
    );
    if (meaningful.length === 0) return {};
    if (meaningful.length === 1) return toSchema(meaningful[0]);
    return { allOf: meaningful.map((m) => toSchema(m)) };
  } else {
    return data[$types].map(toSchema)[0] ?? {};
  }
}

export function isHttpMethod(name: string): name is Method {
  return ['get', 'post', 'put', 'delete', 'patch'].includes(name);
}
