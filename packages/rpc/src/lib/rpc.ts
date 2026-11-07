import { type Tool, jsonSchema, tool } from 'ai';
import type { TagObject } from 'openapi3-ts/oas32';
import { z } from 'zod';

import type { Method as OperationMethod } from '@sdk-it/core';
import * as http from '@sdk-it/runtime';
import {
  Dispatcher,
  type HeadersInit,
  type Interceptor,
  type Method,
  type OutputType,
  type Parser,
  binary,
  bodyless,
  buffered,
  chunked,
  createHeadersInterceptor,
  empty,
  fetchType,
  formdata,
  json,
  parseInput,
  sse,
  text,
  toRequest,
  urlencoded,
} from '@sdk-it/runtime';
import {
  type IR,
  type RequestEncoding,
  type ResponseBody,
  type TunedOperationObject,
  carriesBinary,
  forEachOperation,
  inputEndpoint,
  inputName,
  loadSpec,
  operationInputs,
  statusRange,
  toIR,
} from '@sdk-it/spec';

import { schemaToZod } from './zod.ts';

const bodyParser: Record<ResponseBody, Parser> = {
  json: buffered('json'),
  text: buffered('text'),
  binary: buffered('binary'),
  empty: bodyless,
  stream: chunked,
  sse,
};

const statusClasses = Object.values(http).filter(
  (value) => 'status' in value && typeof value.status === 'number',
);

function toOutputs(operation: TunedOperationObject): OutputType[] {
  return Object.entries(operation.responses).flatMap<OutputType>(
    ([status, response]) => {
      const parser = bodyParser[response['x-body']];
      const range = statusRange(status);
      if (range) {
        const type = range === '2XX' ? http.APIResponse : http.APIError;
        return [{ type, parser, range }];
      }
      const type = statusClasses.find((it) => it.status === Number(status));
      return type ? [{ type, parser }] : [];
    },
  );
}

const callable = z.custom<() => string | Promise<string>>(
  (value) => typeof value === 'function',
);

const baseUrlSchema = z
  .union([z.string(), callable])
  .transform(async (baseUrl, ctx) => {
    const value = typeof baseUrl === 'function' ? await baseUrl() : baseUrl;
    if (typeof value !== 'string') {
      ctx.addIssue({
        code: 'custom',
        message: 'baseUrl must resolve to a string',
      });
      return z.NEVER;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
      return value;
    }
    const page: { href: string } | undefined = Reflect.get(
      globalThis,
      'location',
    );
    if (page === undefined) {
      throw new TypeError(
        `baseUrl "${value}" is relative, and there is no page location to resolve it against.`,
      );
    }
    return new URL(value, page.href).href;
  });

const optionsSchema = z.object({
  token: z
    .union([z.string(), callable])
    .optional()
    .transform(async (token, ctx) => {
      if (!token) return undefined;
      const value = typeof token === 'function' ? await token() : token;
      if (typeof value !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: 'token must resolve to a string',
        });
        return z.NEVER;
      }
      return `Bearer ${value}`;
    }),
  fetch: fetchType,
  baseUrl: baseUrlSchema,
  headers: z.record(z.string(), z.string()).optional(),
});

export type ClientOptions = z.input<typeof optionsSchema>;

export class Client {
  public options: ClientOptions;
  public schemas: Record<string, any>;
  constructor(options: ClientOptions, schemas: Record<string, any>) {
    this.options = options;
    this.schemas = schemas;
  }

  async request(
    endpoint: string,
    input: any,
    options?: { signal?: AbortSignal; headers?: HeadersInit },
  ) {
    const route = this.schemas[endpoint];
    const withDefaultInputs = Object.assign({}, this.#defaultInputs, input);
    const parsedInput = parseInput(route.schema, withDefaultInputs);
    const clientOptions = await optionsSchema.parseAsync(this.options);
    const result = await route.dispatch(parsedInput, {
      fetch: clientOptions.fetch,
      baseUrl: clientOptions.baseUrl,
      interceptors: [
        createHeadersInterceptor(
          await this.#defaultHeaders(),
          options?.headers ?? {},
        ),
      ],
      signal: options?.signal,
    });
    return result;
  }

  async #defaultHeaders() {
    const clientOptions = await optionsSchema.parseAsync(this.options);
    return {
      authorization: clientOptions['token'],
      ...clientOptions.headers,
    };
  }

  get #defaultInputs() {
    return {};
  }

  setOptions(options: Partial<ClientOptions>) {
    this.options = {
      ...this.options,
      ...options,
    };
  }
}

const httpMethods: Record<OperationMethod, Method> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  trace: 'TRACE',
  head: 'HEAD',
};

const serializers: Record<RequestEncoding, typeof json> = {
  json,
  urlencoded,
  formdata,
  text,
  binary,
  empty,
};

export function createRpc(ir: IR, options: Partial<ClientOptions> = {}) {
  const schemas: Record<string, any> = {};
  forEachOperation(ir, (entry, operation) => {
    const method = httpMethods[entry.method];
    for (const sent of operationInputs(ir, operation)) {
      schemas[inputEndpoint(`${method} ${entry.path}`, sent)] = {
        operationId: operation.operationId,
        output: toOutputs(operation),
        schema: schemaToZod(sent.schema, ir, { required: true }),
        async dispatch(
          input: any,
          options: {
            signal?: AbortSignal;
            interceptors: Interceptor[];
            fetch: z.infer<typeof fetchType>;
            baseUrl: string;
          },
        ) {
          const dispatcher = new Dispatcher(
            options.interceptors,
            options.fetch,
          );
          const request = toRequest(
            method,
            entry.path,
            serializers[sent.encoding](input, {
              contentType: sent.contentType,
              inputHeaders: sent.header,
              inputQuery: sent.query,
              inputBody: sent.body,
              inputParams: sent.path,
            }),
            options.baseUrl,
          );
          return dispatcher.send(request, this.output, options.signal);
        },
      };
    }
  });

  const baseUrl = options.baseUrl ?? ir.servers.at(0)?.url;
  if (baseUrl === undefined) {
    throw new Error('rpc: the spec declares no servers; pass options.baseUrl');
  }
  return new Client({ ...options, baseUrl }, schemas);
}

export async function rpc(
  openapi: string,
  options?: Partial<ClientOptions>,
): Promise<Client> {
  const { spec } = await loadSpec(openapi);
  const ir = await toIR({
    spec,
    responses: { flattenErrorResponses: true },
  });
  return createRpc(ir, options);
}

export async function toAgents(
  openapi: string,
  options: ClientOptions & {
    useTools?: 'defined';
  },
) {
  const { spec } = await loadSpec(openapi);
  const ir = await toIR({
    spec,
    responses: { flattenErrorResponses: true },
  });
  const client = createRpc(ir, options);
  const groups: Record<
    string,
    { tools: Record<string, Tool>; definition: TagObject }
  > = {};

  forEachOperation(ir, (entry, operation) => {
    const tagDef = ir.tags.find((tag) => tag.name === entry.tag);
    if (!tagDef) {
      // normalize-tags gives every operation's tag a definition.
      throw new Error(`The IR defines no tag ${entry.tag}`);
    }

    groups[entry.tag] ??= { tools: {}, definition: tagDef };
    const endpoint = `${entry.method.toUpperCase()} ${entry.path}`;
    const toolInfo = operation['x-tool'];

    let includeTool = true;
    if (options.useTools === 'defined') {
      includeTool = !!toolInfo;
    }
    if (includeTool) {
      const name = toolInfo?.name || operation['x-fn-name'];
      for (const sent of operationInputs(ir, operation)) {
        if (carriesBinary(ir, sent)) {
          continue;
        }
        const key = inputEndpoint(endpoint, sent);
        groups[entry.tag].tools[inputName(name, sent)] = tool({
          type: 'function',
          description:
            toolInfo?.description || operation.description || operation.summary,
          inputSchema: toToolSchema(client.schemas[key].schema),
          execute: async (input) => {
            const response = await client.request(key, input);
            return JSON.stringify(response);
          },
        });
      }
    }
  });
  // Each agent is ToolLoopAgent settings: new ToolLoopAgent({ model, ...agent }).
  const agents: Record<
    string,
    { id: string; instructions?: string; tools: Record<string, Tool> }
  > = {};
  for (const [agentName, { tools, definition }] of Object.entries(groups)) {
    // The tag's x-name, else its display name; its x-instructions, else its
    // description. The TypeScript generator's agentSettings repeats this rule.
    const id: string =
      definition['x-name'] ?? definition.summary ?? definition.name;
    const instructions: string | undefined =
      definition['x-instructions'] ?? definition.description;
    agents[agentName] =
      instructions === undefined ? { id, tools } : { id, instructions, tools };
  }

  return agents;
}

const TOOL_COERCE_MARKER = 'x-sdkit-tool-coerce';

/**
 * Rebuild JSON tool-call values into what the zod schema validates: date
 * params are z.date()/z.coerce.date(), which JSON cannot carry. Without this,
 * every tool call shaped exactly as the advertised schema instructs would be
 * rejected by the validator.
 */
function coerceToolValue(value: any, schema: any): any {
  if (
    !schema ||
    typeof schema !== 'object' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  const marker = schema[TOOL_COERCE_MARKER];
  if (marker === 'date' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (Array.isArray(value)) {
    if (Array.isArray(schema.items)) {
      return value.map((item, index) =>
        coerceToolValue(item, schema.items[index] ?? schema.additionalItems),
      );
    }
    if (schema.items) {
      return value.map((item) => coerceToolValue(item, schema.items));
    }
    return value;
  }
  if (
    typeof value === 'object' &&
    (schema.properties || schema.additionalProperties)
  ) {
    const out: Record<string, any> = { ...value };
    for (const [key, propValue] of Object.entries(out)) {
      const propSchema =
        schema.properties?.[key] ??
        (typeof schema.additionalProperties === 'object'
          ? schema.additionalProperties
          : undefined);
      if (propSchema) out[key] = coerceToolValue(propValue, propSchema);
    }
    return out;
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) {
      for (const member of schema[key]) {
        const coerced = coerceToolValue(value, member);
        if (coerced !== value) return coerced;
      }
    }
  }
  return value;
}

/**
 * The ai SDK serializes zod schemas with `unrepresentable: 'throw'`, so a
 * schema containing date/custom/transform (coerce-date, binary inputs) would
 * crash every agent invocation. Precompute a serializable JSON schema and keep
 * argument validation on the zod schema.
 */
function toToolSchema(schema: z.ZodType) {
  const marked = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
    override(ctx) {
      const def = ctx.zodSchema._zod.def;
      const json = ctx.jsonSchema;
      if (def.type === 'date') {
        json.type = 'string';
        json.format = 'date-time';
        json[TOOL_COERCE_MARKER] = 'date';
      }
    },
  });
  const advertised = JSON.parse(
    JSON.stringify(marked, (key, value) =>
      key === TOOL_COERCE_MARKER ? undefined : value,
    ),
  );
  return jsonSchema(advertised, {
    validate: (value) => {
      const coerced = coerceToolValue(value, marked);
      const result = schema.safeParse(coerced);
      // Return the input-form value, not result.data: Client.request runs
      // parseInput itself, so returning the parsed output here would apply
      // schema transforms twice.
      return result.success
        ? { success: true, value: coerced }
        : { success: false, error: result.error };
    },
  });
}
