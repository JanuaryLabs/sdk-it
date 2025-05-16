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
    .string()
    .optional()
    .transform((val) => (val ? `Bearer ${val}` : undefined)),
  fetch: fetchType,
  baseUrl: z.enum(servers).default(servers[0]),
});
export type Servers = (typeof servers)[number];

type SdkItOptions = z.infer<typeof optionsSchema>;

export class SdkIt {
  public options: SdkItOptions;
  constructor(options: SdkItOptions) {
    this.options = optionsSchema.parse(options);
  }

  async request<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.infer<(typeof schemas)[E]['schema']>,
    options?: { signal?: AbortSignal; headers?: HeadersInit },
  ): Promise<ReturnType<(typeof schemas)[E]['dispatch']>> {
    const route = schemas[endpoint];
    const withDefaultInputs = Object.assign({}, this.#defaultInputs, input);
    const [parsedInput, parseError] = parseInput(
      route.schema,
      withDefaultInputs,
    );
    if (parseError) {
      throw parseError;
    }
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
    return result as ReturnType<(typeof schemas)[E]['dispatch']>;
  }

  async prepare<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.infer<(typeof schemas)[E]['schema']>,
    options?: { headers?: HeadersInit },
  ): Promise<
    RequestConfig & {
      parse: (response: Response) => ReturnType<typeof parse>;
    }
  > {
    const route = schemas[endpoint];

    const interceptors = [
      createHeadersInterceptor(
        () => this.defaultHeaders,
        options?.headers ?? {},
      ),
      createBaseUrlInterceptor(() => this.options.baseUrl),
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
      parse: (response: Response) => parse(route.output, response),
    };
    return prepared as any;
  }

  get defaultHeaders() {
    return { authorization: this.options['token'] };
  }

  get #defaultInputs() {
    return {};
  }

  setOptions(options: Partial<SdkItOptions>) {
    const validated = optionsSchema.partial().parse(options);

    for (const key of Object.keys(validated) as (keyof SdkItOptions)[]) {
      if (validated[key] !== undefined) {
        (this.options[key] as (typeof validated)[typeof key]) = validated[key]!;
      }
    }
  }
}
