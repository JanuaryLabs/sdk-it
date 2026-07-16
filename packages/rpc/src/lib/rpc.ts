/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Tool, jsonSchema, tool } from 'ai';
import { z } from 'zod';

import {
  type IR,
  type TunedOperationObject,
  forEachOperation,
  loadSpec,
  toIR,
} from '@sdk-it/spec';
import {
  type OperationInput,
  buildInput,
  operationSchema,
  toHttpOutput,
} from '@sdk-it/typescript';

import { Dispatcher, fetchType } from './http/dispatcher.ts';
import {
  type Interceptor,
  createBaseUrlInterceptor,
  createHeadersInterceptor,
} from './http/interceptors.ts';
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
import { schemaToZod } from './zod.ts';

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
    return value;
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

export function inputToPath(
  operation: TunedOperationObject,
  inputs: Record<string, OperationInput>,
) {
  const inputHeaders: string[] = [];
  const inputQuery: string[] = [];
  const inputBody: string[] = [];
  const inputParams: string[] = [];
  for (const [name, prop] of Object.entries(inputs)) {
    if (prop.in === 'headers' || prop.in === 'header') {
      inputHeaders.push(name);
    } else if (prop.in === 'query') {
      inputQuery.push(name);
    } else if (prop.in === 'body') {
      inputBody.push(name);
    } else if (prop.in === 'path') {
      inputParams.push(name);
    } else {
      throw new Error(
        `Unknown source ${prop.in} in ${name} ${JSON.stringify(
          prop,
        )} in ${operation.operationId}`,
      );
    }
  }

  return {
    inputHeaders,
    inputQuery,
    inputBody,
    inputParams,
  };
}

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
    const result = await route.dispatch(parsedInput as never, {
      fetch: clientOptions.fetch,
      interceptors: [
        createHeadersInterceptor(
          await this.#defaultHeaders(),
          options?.headers ?? {},
        ),
        createBaseUrlInterceptor(clientOptions.baseUrl),
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

export function createRpc(ir: IR, options: Partial<ClientOptions> = {}) {
  const schemas: Record<Endpoint, any> = {};
  forEachOperation(ir, (entry, operation) => {
    const endpoint: Endpoint = `${entry.method.toUpperCase() as Method} ${entry.path}`;
    const details = buildInput(ir, operation);
    const contentTypeMap = {
      json: json,
      urlencoded: urlencoded,
      formdata: formdata,
      empty: empty,
    } as const;
    const outputs = Object.keys(operation.responses).flatMap((status) =>
      toHttpOutput(
        ir,
        operation.operationId,
        status,
        operation.responses[status],
        false,
      ),
    );
    const inputSchema = schemaToZod(
      operationSchema(ir, operation, details.ct),
      ir,
      { required: true },
    );
    schemas[endpoint] = {
      operationId: operation.operationId,
      output: outputs.map((it) => http[it.replace('http.', '') as never]),
      schema: inputSchema,
      async dispatch(
        input: any,
        options: {
          signal?: AbortSignal;
          interceptors: Interceptor[];
          fetch: z.infer<typeof fetchType>;
        },
      ) {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const serializer =
          contentTypeMap[
            details.outgoingContentType as keyof typeof contentTypeMap
          ] || defaultSerializer(details.outgoingContentType);
        const request = toRequest(
          endpoint,
          serializer(input, inputToPath(operation, details.inputs)),
        );
        return dispatcher.send(request, this.output, options.signal);
      },
    };
  });

  return new Client(
    {
      ...options,
      baseUrl: options?.baseUrl ?? ir.servers[0].url,
    },
    schemas,
  );
}

export async function rpc(
  openapi: string,
  options?: Partial<ClientOptions>,
): Promise<Client> {
  const spec = await loadSpec(openapi);
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
  const spec = await loadSpec(openapi);
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

function defaultSerializer(ct: string) {
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
 * schema containing date/custom/transform (coerce-date, binary, x-prefix
 * inputs) would crash every agent invocation. Precompute a serializable JSON
 * schema and keep argument validation on the zod schema.
 */
function toToolSchema(schema: z.ZodType) {
  const marked = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
    override(ctx) {
      const def = ctx.zodSchema._zod.def;
      const json = ctx.jsonSchema as Record<string, unknown>;
      if (def.type === 'date') {
        json.type = 'string';
        json.format = 'date-time';
        json[TOOL_COERCE_MARKER] = 'date';
      }
    },
  }) as Record<string, unknown>;
  const advertised = JSON.parse(
    JSON.stringify(marked, (key, value) =>
      key === TOOL_COERCE_MARKER ? undefined : value,
    ),
  );
  return jsonSchema(advertised as never, {
    validate: (value) => {
      const coerced = coerceToolValue(value, marked);
      const result = schema.safeParse(coerced);
      // Return the input-form value, not result.data: Client.request runs
      // parseInput itself, so returning the parsed output here would apply
      // schema transforms twice (e.g. x-prefix -> 'Bearer Bearer <token>').
      return result.success
        ? { success: true, value: coerced }
        : { success: false, error: result.error };
    },
  });
}
