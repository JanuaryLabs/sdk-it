import z from 'zod';

import type { InferData } from './api/endpoints.ts';
import schemas from './api/schemas.ts';
import { fetchType, parse } from './http/dispatcher.ts';
import {
  createBaseUrlInterceptor,
  createHeadersInterceptor,
} from './http/interceptors.ts';
import { type ParseError, parseInput } from './http/parser.ts';
import type { HeadersInit, RequestConfig } from './http/request.ts';
import { APIResponse } from './http/response.ts';

export const servers = ['/', 'http://localhost:3000'] as const;
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
  baseUrl: z.enum(servers).default(servers[0]),
  headers: z.record(z.string()).optional(),
});
export type Servers = (typeof servers)[number];

type SdkItOptions = z.input<typeof optionsSchema>;

export class SdkIt {
  public options: SdkItOptions;
  constructor(options: SdkItOptions) {
    this.options = options;
  }

  async request<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.input<(typeof schemas)[E]['schema']>,
    options?: { signal?: AbortSignal; headers?: HeadersInit },
  ) {
    return request(this, endpoint, input, options).then(function unwrap(it) {
      if (it instanceof APIResponse) {
        return it.data as InferData<E>;
      }
      return it as InferData<E>;
    });
  }

  async prepare<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.input<(typeof schemas)[E]['schema']>,
    options?: { headers?: HeadersInit },
  ): Promise<
    RequestConfig & {
      parse: (response: Response) => ReturnType<typeof parse>;
    }
  > {
    const clientOptions = await optionsSchema.parseAsync(this.options);
    const route = schemas[endpoint];
    const interceptors = [
      createHeadersInterceptor(
        await this.defaultHeaders(),
        options?.headers ?? {},
      ),
      createBaseUrlInterceptor(clientOptions.baseUrl),
    ];
    const parsedInput = parseInput(route.schema, input);

    let config = route.toRequest(parsedInput as never);
    for (const interceptor of interceptors) {
      if (interceptor.before) {
        config = await interceptor.before(config);
      }
    }
    const prepared = {
      ...config,
      parse: (response: Response) =>
        parse(route.output, response, (d) => d) as never,
    };
    return prepared as any;
  }

  async defaultHeaders() {
    const options = await optionsSchema.parseAsync(this.options);
    return {
      ...{ authorization: options['token'] },
      ...options.headers,
    };
  }

  async defaultInputs() {
    const options = await optionsSchema.parseAsync(this.options);
    return {};
  }

  setOptions(options: Partial<SdkItOptions>) {
    this.options = {
      ...this.options,
      ...options,
    };
  }
}

export async function request<const E extends keyof typeof schemas>(
  client: SdkIt,
  endpoint: E,
  input: z.input<(typeof schemas)[E]['schema']>,
  options?: { signal?: AbortSignal; headers?: HeadersInit },
): Promise<Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>> {
  const route = schemas[endpoint];
  const withDefaultInputs = Object.assign(
    {},
    await client.defaultInputs(),
    input,
  );
  const parsedInput = parseInput(route.schema, withDefaultInputs);
  const clientOptions = await optionsSchema.parseAsync(client.options);
  const result = await route.dispatch(parsedInput as never, {
    fetch: clientOptions.fetch,
    interceptors: [
      createHeadersInterceptor(
        await client.defaultHeaders(),
        options?.headers ?? {},
      ),
      createBaseUrlInterceptor(clientOptions.baseUrl),
    ],
    signal: options?.signal,
  });
  return result as Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>;
}
