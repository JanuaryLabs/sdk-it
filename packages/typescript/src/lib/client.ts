import { toLitObject } from '@sdk-it/core';

import type { Spec } from './sdk.ts';

export default (spec: Omit<Spec, 'operations'>) => {
  const callableString = `z.custom<() => string | Promise<string>>((value) => typeof value === 'function')`;
  const baseUrlSchema = `z.union([z.string(),${callableString},])${spec.servers.length === 1 ? '.default(servers[0])' : ''}`;
  const securitySchemeNames = Object.keys(spec.securitySchemes);

  const specOptions: Record<string, { schema: string }> = {
    ...(securitySchemeNames.length
      ? {
          credentials: {
            schema: `credentialsSchema.optional().describe('Credentials keyed by OpenAPI security scheme name.')`,
          },
        }
      : {}),
    fetch: {
      schema: `fetchType.describe('Custom fetch implementation. Defaults to globalThis.fetch.')`,
    },
    baseUrl: {
      schema: `${baseUrlSchema}.transform(async (baseUrl, ctx) => {
      const value = typeof baseUrl === 'function' ? await baseUrl() : baseUrl;
      if (typeof value !== 'string') {
        ctx.addIssue({ code: 'custom', message: 'baseUrl must resolve to a string' });
        return z.NEVER;
      }
      return value;
    }).describe('Base URL of the API server. Can be a string or a function that returns a string.')`,
    },
    headers: {
      schema: `z.record(z.string(), z.string()).optional().describe('Default headers to include in all requests.')`,
    },
    skipValidation: {
      schema: `z.boolean().optional().describe('Skip request input validation. Client options and TypeScript types still enforce correct usage.')`,
    },
  };

  return `import z from 'zod';
import { APIResponse } from '${spec.makeImport('./http/response')}';
import type { HeadersInit, RequestConfig } from './http/${spec.makeImport('request')}';
import { fetchType, parse } from './http/${spec.makeImport('dispatcher')}';
import schemas from './api/${spec.makeImport('schemas')}';
import type { InferData } from '${spec.makeImport('./api/endpoints')}';
import {
  createBaseUrlInterceptor,
  createHeadersInterceptor,
} from './http/${spec.makeImport('interceptors')}';

import { type ParseError, parseInput } from './http/${spec.makeImport('parser')}';${
    securitySchemeNames.length
      ? `
import { credentialsSchema, createSecurityInterceptor } from './http/${spec.makeImport('security')}';
export type {
  SecurityContext,
  SecurityCredential,
  SecurityCredentialProvider,
  SecurityCredentialValue,
} from './http/${spec.makeImport('security')}';`
      : ''
  }

${spec.servers.length ? `export const servers = ${JSON.stringify(spec.servers, null, 2)} as const` : ''}
const optionsSchema = z.object(${toLitObject(specOptions, (x) => x.schema)});
${spec.servers.length ? `export type Servers = typeof servers[number];` : ''}

type ${spec.name}Options = z.input<typeof optionsSchema>;

export class ${spec.name} {
  public options: ${spec.name}Options;
  constructor(options: ${spec.name}Options) {
    this.options = options;
  }

  /** Sends a request and returns the unwrapped response data. Delegates to the standalone {@link request} function. */
  async request<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.input<(typeof schemas)[E]['schema']>,
    options?: { signal?: AbortSignal; headers?: HeadersInit },
  ) {
    return request(this, endpoint, input, options).then(function unwrap(
      it: unknown,
    ) {
      if (it instanceof APIResponse) {
        return it.data as InferData<E>;
      }
      return it as InferData<E>;
    });
  }

  /** Builds a ready-to-send request without sending it. Delegates to the standalone {@link prepare} function. */
  async prepare<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.input<(typeof schemas)[E]['schema']>,
    options?: { signal?: AbortSignal; headers?: HeadersInit },
  ) {
    return prepare(this, endpoint, input, options);
  }

  async defaultHeaders() {
    const options = await optionsSchema.parseAsync(this.options);
    return { ...options.headers };
  }

  setOptions(options: Partial<${spec.name}Options>) {
    this.options = {
      ...this.options,
      ...options,
    };
  }

}

/**
 * Sends a validated request using the client's configuration and returns the parsed response.
 * Applies the client's default headers before sending.
 * Throws \`APIError\` on non-ok responses.
 *
 * @example
 * \`\`\`ts
 * const result = await request(client, 'GET /users', { limit: 10 });
 * \`\`\`
 */
export async function request<const E extends keyof typeof schemas>(
  client: ${spec.name},
  endpoint: E,
  input: z.input<(typeof schemas)[E]['schema']>,
  requestOptions?: { signal?: AbortSignal; headers?: HeadersInit },
): Promise<Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>> {
  const route = schemas[endpoint];
  const options = await optionsSchema.parseAsync(client.options);
  const parsedInput = options.skipValidation ? input : parseInput(route.schema, input);
  const result = await route.dispatch(parsedInput as never, {
    fetch: options.fetch,
    interceptors: [
      createHeadersInterceptor(
        { ...options.headers },
        requestOptions?.headers ?? {},
      ),
${securitySchemeNames.length ? '      createSecurityInterceptor(route.security, options.credentials),\n' : ''}      createBaseUrlInterceptor(options.baseUrl),
    ],
    signal: requestOptions?.signal,
  });
  return result as Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>;
}

/**
 * Builds a validated \`RequestConfig\` (url + init) with a \`parse\` function attached, without sending.
 * Use when you need control over the fetch call — framework integration (Next.js, SvelteKit),
 * custom retry/logging, request batching, or testing.
 *
 * @example
 * \`\`\`ts
 * const { url, init, parse } = await prepare(client, 'GET /users', { limit: 10 });
 * const response = await fetch(new Request(url, init));
 * const result = await parse(response);
 * \`\`\`
 */
export async function prepare<const E extends keyof typeof schemas>(
  client: ${spec.name},
  endpoint: E,
  input: z.input<(typeof schemas)[E]['schema']>,
  requestOptions?: { signal?: AbortSignal; headers?: HeadersInit },
): Promise<RequestConfig & {
  parse: (response: Response) => ReturnType<typeof parse>;
}> {
  const route = schemas[endpoint];
  const options = await optionsSchema.parseAsync(client.options);
  const parsedInput = options.skipValidation ? input : parseInput(route.schema, input);
  const interceptors = [
    createHeadersInterceptor(
      { ...options.headers },
      requestOptions?.headers ?? {},
    ),
${securitySchemeNames.length ? '    createSecurityInterceptor(route.security, options.credentials),\n' : ''}    createBaseUrlInterceptor(options.baseUrl),
  ];

  let config = route.toRequest(parsedInput as never);
  if (requestOptions?.signal) {
    config = {
      ...config,
      init: {
        ...config.init,
        signal: requestOptions.signal,
      },
    };
  }
  for (const interceptor of interceptors) {
    if (interceptor.before) {
      config = await interceptor.before(config);
    }
  }
  return { ...config, parse: (response: Response) => parse(route.output as never, response, (d) => d) as never } as any;
}


`;
};
