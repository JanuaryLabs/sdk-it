import { toLitObject } from '@sdk-it/core';

import { toZod } from './emitters/zod.ts';
import type { Spec } from './sdk.ts';

export default (spec: Omit<Spec, 'operations'>) => {
  const baseUrlSchema = `z.union([z.string(),z.function().returns(z.union([z.string(), z.promise(z.string())])),])${spec.servers.length ? '.default(servers[0])' : ''}`;
  const defaultHeaders = `{${spec.options
    .filter((value) => value.in === 'header')
    .map(
      (value) =>
        `'${value.name}': options['${value['x-optionName'] ?? value.name}']`,
    )
    .join(',\n')}}`;
  const defaultInputs = `{${spec.options
    .filter((value) => value.in === 'input')
    .map(
      (value) =>
        `'${value.name}': options['${value['x-optionName'] ?? value.name}']`,
    )
    .join(',\n')}}`;

  /**
   * Map of option name to zod schema (as string)
   * Usually stuff like token, apiKey and so on.
   */
  const globalOptions = Object.fromEntries(
    spec.options.map((value) => [
      `'${value['x-optionName'] ?? value.name}'`,
      { schema: toZod(value.schema, value.required) },
    ]),
  );

  const specOptions: Record<string, { schema: string }> = {
    ...globalOptions,
    ...(globalOptions["'token'"]
      ? {
          "'token'": {
            schema: `z.union([z.string(),z.function().returns(z.union([z.string(), z.promise(z.string())])),]).optional()
    .transform(async (token) => {
      if (!token) return undefined;
      if (typeof token === 'function') {
        token = await Promise.resolve(token());
      }
      return \`Bearer \${token}\`;
    }).describe('Bearer token for authentication. Can be a string or a function that returns a string.')`,
          },
        }
      : {}),
    fetch: {
      schema: `fetchType.describe('Custom fetch implementation. Defaults to globalThis.fetch.')`,
    },
    baseUrl: {
      schema: `${baseUrlSchema}.transform(async (baseUrl) => {
      if (typeof baseUrl === 'function') {
        return Promise.resolve(baseUrl());
      }
      return baseUrl;
    }).describe('Base URL of the API server. Can be a string or a function that returns a string.')`,
    },
    headers: {
      schema: `z.record(z.string()).optional().describe('Default headers to include in all requests.')`,
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

import { type ParseError, parseInput } from './http/${spec.makeImport('parser')}';

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
    return request(this, endpoint, input, options).then(function unwrap(it) {
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
    return {
      ...${defaultHeaders},
      ...options.headers,
    };
  }

  async defaultInputs() {
    const options = await optionsSchema.parseAsync(this.options);
    return ${defaultInputs}
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
 * Merges the client's default inputs and headers before sending.
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
  const withDefaultInputs = Object.assign(
    {},
    ${defaultInputs},
    input,
  );
  const parsedInput = options.skipValidation ? withDefaultInputs : parseInput(route.schema, withDefaultInputs);
  const result = await route.dispatch(parsedInput as never, {
    fetch: options.fetch,
    interceptors: [
      createHeadersInterceptor(
        { ...${defaultHeaders}, ...options.headers },
        requestOptions?.headers ?? {},
      ),
      createBaseUrlInterceptor(options.baseUrl),
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
  const withDefaultInputs = Object.assign(
    {},
    ${defaultInputs},
    input,
  );
  const parsedInput = options.skipValidation ? withDefaultInputs : parseInput(route.schema, withDefaultInputs);
  const interceptors = [
    createHeadersInterceptor(
      { ...${defaultHeaders}, ...options.headers },
      requestOptions?.headers ?? {},
    ),
    createBaseUrlInterceptor(options.baseUrl),
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
