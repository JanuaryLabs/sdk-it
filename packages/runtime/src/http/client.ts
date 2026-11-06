import { z } from 'zod';

import {
  type OutputType,
  type Unionize,
  fetchType,
  parse,
} from './dispatcher.ts';
import { type Interceptor, createHeadersInterceptor } from './interceptors.ts';
import { type ParseError, parseInput } from './parser.ts';
import type { HeadersInit, RequestConfig } from './request.ts';
import {
  APIResponse,
  type ProblematicResponse,
  type SuccessfulResponse,
} from './response.ts';
import {
  type RuntimeSecuritySchemes,
  type SecurityCredential,
  createSecurityInterceptor,
} from './security.ts';

export interface DispatchOptions {
  interceptors: Interceptor[];
  fetch: z.infer<typeof fetchType>;
  baseUrl: string;
  signal?: AbortSignal;
}

/** One operation of a generated SDK's endpoint table. */
export interface Route {
  schema: z.ZodType;
  output: OutputType[];
  security: readonly Record<string, readonly string[]>[];
  toRequest(input: unknown, baseUrl: string): RequestConfig;
  dispatch(input: unknown, options: DispatchOptions): Promise<unknown>;
}

/** What a generated SDK knows about its API: its endpoint table, servers and security. */
export interface Api {
  routes: Record<string, Route>;
  /** The spec's server URLs with their variables' defaults. */
  servers: readonly string[];
  securitySchemes: RuntimeSecuritySchemes;
  /** Validates `credentials`: one optional entry per security scheme. */
  credentials: z.ZodType<Record<string, SecurityCredential | undefined>>;
}

type BaseUrl = string | (() => string | Promise<string>);

/** A spec with two or more servers has no single default, so the caller picks one. */
type BaseUrlSetting<A extends Api> = A['servers'] extends readonly [
  unknown,
  unknown,
  ...unknown[],
]
  ? { baseUrl: BaseUrl }
  : { baseUrl?: BaseUrl };

type CredentialsSetting<A extends Api> =
  keyof A['securitySchemes'] extends never
    ? unknown
    : { credentials?: z.input<A['credentials']> };

export type ClientSettings<A extends Api> = BaseUrlSetting<A> &
  CredentialsSetting<A> & {
    headers?: Record<string, string>;
    fetch?: (request: Request) => Promise<Response>;
    /** Skip request input validation. Settings and TypeScript types still enforce correct usage. */
    skipValidation?: boolean;
  };

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

type DispatchReturn<A extends Api, E extends keyof A['routes']> = Awaited<
  ReturnType<A['routes'][E]['dispatch']>
>;

export type InferData<A extends Api, E extends keyof A['routes']> =
  DispatchReturn<A, E> extends APIResponse<infer D> ? D : DispatchReturn<A, E>;

export type EndpointsOf<A extends Api> = {
  [E in keyof A['routes']]: {
    input: z.input<A['routes'][E]['schema']>;
    output: InferData<A, E>;
    error:
      | Extract<Unionize<A['routes'][E]['output']>, ProblematicResponse>
      | ParseError<A['routes'][E]['schema']>;
  };
};

const baseUrlSchema = z
  .union([
    z.string(),
    z.custom<() => string | Promise<string>>(
      (value) => typeof value === 'function',
    ),
  ])
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

function settingsSchema(api: Api) {
  const [server, ...others] = api.servers;
  return z.object({
    // OpenAPI 3.2: a spec without servers is served from "/".
    baseUrl:
      others.length > 0 ? baseUrlSchema : baseUrlSchema.prefault(server ?? '/'),
    headers: z.record(z.string(), z.string()).optional(),
    fetch: fetchType,
    skipValidation: z.boolean().optional(),
    credentials: api.credentials.optional(),
  });
}

export class Client<A extends Api> {
  readonly api: A;
  options: ClientSettings<A>;
  readonly #settings: ReturnType<typeof settingsSchema>;

  constructor(api: A, options: ClientSettings<A>) {
    this.api = api;
    this.options = options;
    this.#settings = settingsSchema(api);
  }

  /** The settings, validated, with baseUrl resolved. */
  async settings() {
    return this.#settings.parseAsync(this.options);
  }

  /** Sends a request and returns the unwrapped response data. */
  async request<const E extends keyof A['routes'] & string>(
    endpoint: E,
    input: z.input<A['routes'][E]['schema']>,
    options?: RequestOptions,
  ): Promise<InferData<A, E>>;
  async request(
    endpoint: string,
    input: unknown,
    options?: RequestOptions,
  ): Promise<unknown> {
    const result = await send(this, endpoint, input, options);
    return result instanceof APIResponse ? result.data : result;
  }

  /** Builds a ready-to-send request without sending it. */
  async prepare<const E extends keyof A['routes'] & string>(
    endpoint: E,
    input: z.input<A['routes'][E]['schema']>,
    options?: RequestOptions,
  ) {
    return prepare(this, endpoint, input, options);
  }

  async defaultHeaders() {
    const settings = await this.settings();
    return { ...settings.headers };
  }

  setOptions(options: Partial<ClientSettings<A>>) {
    this.options = { ...this.options, ...options };
  }
}

export function createClient<A extends Api>(
  api: A,
  settings: ClientSettings<A>,
): Client<A> {
  return new Client(api, settings);
}

function interceptorsFor(
  route: Route,
  settings: Awaited<ReturnType<Client<Api>['settings']>>,
  api: Api,
  options: RequestOptions | undefined,
) {
  return [
    createHeadersInterceptor({ ...settings.headers }, options?.headers ?? {}),
    createSecurityInterceptor(
      route.security,
      settings.credentials,
      api.securitySchemes,
    ),
  ];
}

/**
 * Sends a validated request with the client's settings and returns the
 * response status class (status, headers, data). Throws `APIError` on
 * non-ok responses.
 */
export async function request<
  A extends Api,
  const E extends keyof A['routes'] & string,
>(
  client: Client<A>,
  endpoint: E,
  input: z.input<A['routes'][E]['schema']>,
  options?: RequestOptions,
): Promise<DispatchReturn<A, E>>;
export async function request(
  client: Client<Api>,
  endpoint: string,
  input: unknown,
  options?: RequestOptions,
): Promise<unknown> {
  return send(client, endpoint, input, options);
}

async function send(
  client: Client<Api>,
  endpoint: string,
  input: unknown,
  options: RequestOptions | undefined,
) {
  const route = client.api.routes[endpoint];
  const settings = await client.settings();
  const parsedInput = settings.skipValidation
    ? input
    : parseInput(route.schema, input);
  return route.dispatch(parsedInput, {
    fetch: settings.fetch,
    baseUrl: settings.baseUrl,
    interceptors: interceptorsFor(route, settings, client.api, options),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

/**
 * Builds a validated `RequestConfig` (url + init) with a `parse` function
 * attached, without sending it.
 */
export async function prepare<
  A extends Api,
  const E extends keyof A['routes'] & string,
>(
  client: Client<A>,
  endpoint: E,
  input: z.input<A['routes'][E]['schema']>,
  options?: RequestOptions,
): Promise<
  RequestConfig & {
    parse: (response: Response) => Promise<DispatchReturn<A, E>>;
  }
>;
export async function prepare(
  client: Client<Api>,
  endpoint: string,
  input: unknown,
  options?: RequestOptions,
): Promise<
  RequestConfig & { parse: (response: Response) => Promise<unknown> }
> {
  const route = client.api.routes[endpoint];
  const settings = await client.settings();
  const parsedInput = settings.skipValidation
    ? input
    : parseInput(route.schema, input);
  let config = route.toRequest(parsedInput, settings.baseUrl);
  if (options?.signal) {
    config = { ...config, init: { ...config.init, signal: options.signal } };
  }
  for (const interceptor of interceptorsFor(
    route,
    settings,
    client.api,
    options,
  )) {
    if (interceptor.before) {
      config = await interceptor.before(config);
    }
  }
  return {
    ...config,
    parse: (response: Response) => parse(route.output, response),
  };
}
