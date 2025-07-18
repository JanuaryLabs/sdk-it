/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import { augmentSpec, forEachOperation, loadSpec } from '@sdk-it/spec';
import { buildInput, inputToPath, toHttpOutput } from '@sdk-it/typescript';

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

const optionsSchema = z.object({
  token: z
    .string()
    .optional()
    .transform((val) => (val ? `Bearer ${val}` : undefined)),
  fetch: fetchType,
  baseUrl: z.string(),
});
type ClientOptions = z.infer<typeof optionsSchema>;

export class Client {
  public options: ClientOptions;
  public schemas: Record<string, any>;
  constructor(options: ClientOptions, schemas: Record<string, any>) {
    this.options = optionsSchema.parse(options);
    this.schemas = schemas;
  }

  async request(
    endpoint: string,
    input: any,
    options?: { signal?: AbortSignal; headers?: HeadersInit },
  ) {
    const route = this.schemas[endpoint];
    console.log(route);
    const withDefaultInputs = Object.assign({}, this.#defaultInputs, input);
    // const [parsedInput, parseError] = parseInput(
    //   route.schema,
    //   withDefaultInputs,
    // );
    // if (parseError) {
    //   throw parseError;
    // }
    const parsedInput = input;
    const result = await route.dispatch(parsedInput as never, {
      fetch: this.options.fetch,
      interceptors: [
        createHeadersInterceptor(
          () => this.defaultHeaders,
          options?.headers ?? {},
        ),
        createBaseUrlInterceptor(() => this.options.baseUrl),
      ],
      signal: options?.signal,
    });
    return result;
  }

  get defaultHeaders() {
    return { authorization: this.options['token'] };
  }

  get #defaultInputs() {
    return {};
  }

  setOptions(options: Partial<ClientOptions>) {
    const validated = optionsSchema.partial().parse(options);

    for (const key of Object.keys(validated) as (keyof ClientOptions)[]) {
      if (validated[key] !== undefined) {
        (this.options[key] as (typeof validated)[typeof key]) = validated[key]!;
      }
    }
  }
}

export async function rpc(openapi: string, options?: Partial<ClientOptions>) {
  const spec = await loadSpec(openapi);
  const ir = augmentSpec({ spec, responses: { flattenErrorResponses: true } });
  const schemas: Record<string, any> = {};

  forEachOperation(ir, (entry, operation) => {
    const endpoint: Endpoint = `${entry.method.toUpperCase() as Method} ${entry.path}`;
    const details = buildInput(ir, operation);
    const contentTypeMap = {
      json: json,
      urlencoded: urlencoded,
      formdata: formdata,
      empty: empty,
    } as const;
    console.log(operation.responses);
    const outputs = Object.keys(operation.responses).flatMap((status) =>
      toHttpOutput(
        spec,
        operation.operationId,
        status,
        operation.responses[status],
        false,
      ),
    );
    schemas[endpoint] = {
      output: outputs.map((it) => http[it.replace('http.', '') as never]),
      toRequest(input: any) {
        const serializer =
          contentTypeMap[
            details.outgoingContentType as keyof typeof contentTypeMap
          ] || defaultSerializer(details.outgoingContentType);
        return toRequest(
          endpoint,
          serializer(input, inputToPath(operation, details.inputs)),
        );
      },
      async dispatch(
        input: any,
        options: {
          signal?: AbortSignal;
          interceptors: Interceptor[];
          fetch: z.infer<typeof fetchType>;
        },
      ) {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const result = await dispatcher.send(
          this.toRequest(input),
          this.output,
        );
        return result;
      },
    };
  });

  console.log(schemas);

  return new Client(
    {
      ...options,
      baseUrl: options?.baseUrl ?? ir.servers[0].url,
    },
    schemas,
  );
}

function defaultSerializer(ct: string) {
  throw new Error(`Unsupported content type: ${ct}`);
}
