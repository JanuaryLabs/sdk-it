/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Tool, tool } from 'ai';
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

const optionsSchema = z.object({
  token: z
    .union([
      z.string(),
      z.function().returns(z.union([z.string(), z.promise(z.string())])),
    ])
    .optional()
    .transform(async (token) => {
      if (!token) return undefined;
      if (typeof token === 'function') {
        token = await Promise.resolve(token());
      }
      return `Bearer ${token}`;
    }),
  fetch: fetchType,
  baseUrl: z.string(),
  headers: z.record(z.string()).optional(),
});

type ClientOptions = z.input<typeof optionsSchema>;

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
    // const [parsedInput, parseError] = parseInput(
    //   route.schema,
    //   withDefaultInputs,
    // );
    // if (parseError) {
    //   throw parseError;
    // }
    const parsedInput = input;
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

function createRpc(ir: IR, options: Partial<ClientOptions> = {}) {
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
        return dispatcher.send(request, this.output);
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
  const ir = toIR({ spec, responses: { flattenErrorResponses: true } });
  return createRpc(ir, options);
}

export async function toAgents(
  openapi: string,
  options: ClientOptions & {
    useTools?: 'defined';
  },
) {
  const spec = await loadSpec(openapi);
  const ir = toIR({ spec, responses: { flattenErrorResponses: true } });
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
        inputSchema: client.schemas[endpoint].schema,
        execute: async (input) => {
          console.log('Executing tool with input:', input);
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
