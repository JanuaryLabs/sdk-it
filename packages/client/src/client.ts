import z from 'zod';

import schemas from './api/schemas.ts';
import { fetchType, parse } from './http/dispatcher.ts';
import {
  createBaseUrlInterceptor,
  createHeadersInterceptor,
} from './http/interceptors.ts';
import { type ParseError, parseInput } from './http/parser.ts';
import type { HeadersInit, RequestConfig } from './http/request.ts';

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
  ): Promise<Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>> {
    const route = schemas[endpoint];
    const withDefaultInputs = Object.assign(
      {},
      await this.#defaultInputs(),
      input,
    );
    const [parsedInput, parseError] = parseInput(
      route.schema,
      withDefaultInputs,
    );
    if (parseError) {
      throw parseError;
    }
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
    return result as Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>;
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
        await this.#defaultHeaders(),
        options?.headers ?? {},
      ),
      createBaseUrlInterceptor(clientOptions.baseUrl),
    ];
    const [parsedInput, parseError] = parseInput(route.schema, input);
    if (parseError) {
      throw parseError;
    }

    let config = route.toRequest(parsedInput as never);
    for (const interceptor of interceptors) {
      if (interceptor.before) {
        config = await interceptor.before(config);
      }
    }
    const prepared = {
      ...config,
      parse: (response: Response) => parse(route.output, response) as never,
    };
    return prepared as any;
  }

  async #defaultHeaders() {
    const options = await optionsSchema.parseAsync(this.options);
    return {
      ...{ authorization: options['token'] },
      ...options.headers,
    };
  }

  async #defaultInputs() {
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
