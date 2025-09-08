import { toLitObject } from '@sdk-it/core';

import { toZod } from './emitters/zod.ts';
import type { Spec } from './sdk.ts';
import type { Style } from './style.ts';

export default (spec: Omit<Spec, 'operations'>, style: Style) => {
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
    })`,
          },
        }
      : {}),
    fetch: {
      schema: 'fetchType',
    },
    baseUrl: {
      schema: spec.servers.length
        ? `z.enum(servers).default(servers[0])`
        : 'z.string()',
    },
    headers: {
      schema: 'z.record(z.string()).optional()',
    },
  };

  return `import z from 'zod';
import type { HeadersInit, RequestConfig } from './http/${spec.makeImport('request')}';
import { fetchType, parse } from './http/${spec.makeImport('dispatcher')}';
import schemas from './api/${spec.makeImport('schemas')}';
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

  async request<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.input<(typeof schemas)[E]['schema']>,
    options?: { signal?: AbortSignal, headers?: HeadersInit },
  ) ${style.errorAsValue ? `: Promise<Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>| [never, ParseError<(typeof schemas)[E]['schema']>]>` : `: Promise<Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>>`} {
    const route = schemas[endpoint];
    const withDefaultInputs = Object.assign({}, await this.#defaultInputs(), input);
    const [parsedInput, parseError] = parseInput(route.schema, withDefaultInputs);
    if (parseError) {
      ${style.errorAsValue ? 'return [null as never, parseError as never] as const;' : 'throw parseError;'}
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
  ): ${
    style.errorAsValue
      ? `Promise<
    readonly [
      RequestConfig & {
        parse: (response: Response) => ReturnType<typeof parse>;
      },
      ParseError<(typeof schemas)[E]['schema']> | null,
    ]
  >`
      : `Promise<RequestConfig & {
        parse: (response: Response) => ReturnType<typeof parse>;
      }>`
  } {
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
      ${style.errorAsValue ? 'return [null as never, parseError as never] as const;' : 'throw parseError;'}
    }

    let config = route.toRequest(parsedInput as never);
    for (const interceptor of interceptors) {
      if (interceptor.before) {
        config = await interceptor.before(config);
      }
    }
    const prepared = { ...config, parse: (response: Response) => parse(route.output, response) as never };
    return ${style.errorAsValue ? '[prepared, null as never] as const;' : 'prepared as any'}
  }

  async #defaultHeaders() {
    const options = await optionsSchema.parseAsync(this.options);
    return {
      ...${defaultHeaders},
      ...options.headers,
    };
  }

  async #defaultInputs() {
    const options = await optionsSchema.parseAsync(this.options);
    return ${defaultInputs}
  }

  setOptions(options: Partial<${spec.name}Options>) {
    this.options = {
      ...this.options,
      ...options,
    };
  }

}`;
};
