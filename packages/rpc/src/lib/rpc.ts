import { type Tool, jsonSchema, tool } from 'ai';
import { z } from 'zod';

import type { Method as OperationMethod } from '@sdk-it/core';
import {
  type IR,
  type ResponseBody,
  type TunedOperationObject,
  forEachOperation,
  inputSchema,
  loadSpec,
  operationInput,
  toIR,
} from '@sdk-it/spec';

import {
  Dispatcher,
  type OutputType,
  type Parser,
  fetchType,
} from './http/dispatcher.ts';
import {
  type Interceptor,
  createHeadersInterceptor,
} from './http/interceptors.ts';
import { bodyless, buffered, chunked } from './http/parse-response.ts';
import { parseInput } from './http/parser.ts';
import {
  type Endpoint,
  type HeadersInit,
  type Method,
  empty,
  formdata,
  json,
  toRequest,
  urlencoded,
} from './http/request.ts';
import * as http from './http/response.ts';
import { sse } from './http/sse.ts';
import { schemaToZod } from './zod.ts';

const bodyParser: Record<ResponseBody, Parser> = {
  json: buffered,
  text: buffered,
  binary: buffered,
  empty: bodyless,
  stream: chunked,
  sse,
};

const statusClasses = Object.values(http).filter(
  (value) => typeof value.status === 'number',
);

function toOutputs(operation: TunedOperationObject): OutputType[] {
  return Object.entries(operation.responses).flatMap(([status, response]) => {
    const type = statusClasses.find((it) => it.status === Number(status));
    return type ? [{ type, parser: bodyParser[response['x-body']] }] : [];
  });
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

export function createRpc(ir: IR, options: Partial<ClientOptions> = {}) {
  const schemas: Record<Endpoint, any> = {};
  forEachOperation(ir, (entry, operation) => {
    const endpoint: Endpoint = `${httpMethods[entry.method]} ${entry.path}`;
    const sent = operationInput(ir, operation);
    const contentTypeMap: Partial<Record<typeof sent.encoding, typeof json>> = {
      json,
      urlencoded,
      formdata,
      empty,
    };
    const schema = schemaToZod(
      inputSchema(ir, operation, sent.contentType),
      ir,
      { required: true },
    );
    schemas[endpoint] = {
      operationId: operation.operationId,
      output: toOutputs(operation),
      schema,
      async dispatch(
        input: any,
        options: {
          signal?: AbortSignal;
          interceptors: Interceptor[];
          fetch: z.infer<typeof fetchType>;
          baseUrl: string;
        },
      ) {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const serializer =
          contentTypeMap[sent.encoding] || defaultSerializer(sent.encoding);
        const request = toRequest(
          endpoint,
          serializer(input, {
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
    {
      tools: Record<string, Tool>;
      instructions: string;
      handoffDescription: string;
      displayName: string;
      name: string;
    }
  > = {};

  forEachOperation(ir, (entry, operation) => {
    const tagDef = ir.tags.find((tag) => tag.name === entry.tag);
    if (!tagDef) {
      console.warn(`No tag details found for tag: ${entry.tag}`);
      return;
    }

    groups[entry.tag] ??= {
      tools: {},
      instructions: '',
      displayName: '',
      name: '',
      handoffDescription: '',
    };
    const endpoint = `${entry.method.toUpperCase()} ${entry.path}`;
    const toolInfo = operation['x-tool'];

    let includeTool = true;
    if (options.useTools === 'defined') {
      includeTool = !!toolInfo;
    }
    if (includeTool) {
      groups[entry.tag].tools[toolInfo?.name || operation['x-fn-name']] = tool({
        type: 'function',
        description:
          toolInfo?.description || operation.description || operation.summary,
        inputSchema: toToolSchema(client.schemas[endpoint].schema),
        execute: async (input) => {
          const response = await client.request(endpoint, input);
          return JSON.stringify(response);
        },
      });
    }
    groups[entry.tag].handoffDescription = tagDef['x-handoff-description'];
    groups[entry.tag].instructions = tagDef['x-instructions'];
    groups[entry.tag].name = tagDef.name;
    groups[entry.tag].displayName = tagDef['x-name'];
  });
  const agents: Record<string, any> = {};
  for (const [
    agentName,
    { tools, instructions, displayName },
  ] of Object.entries(groups)) {
    agents[agentName] = {
      name: displayName,
      instructions,
      tools,
    };
  }

  return agents;
}

function defaultSerializer(ct: string): never {
  throw new Error(`Unsupported content type: ${ct}`);
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
