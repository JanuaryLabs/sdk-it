import { toLitObject } from '@sdk-it/core';

import type { Spec } from './sdk.ts';
import type { Style } from './style.ts';

export default (spec: Omit<Spec, 'operations'>, style: Style) => {
  const optionsEntries = Object.entries(spec.options).map(
    ([key, value]) => [`'${key}'`, value] as const,
  );
  const defaultHeaders = `{${optionsEntries
    .filter(([, value]) => value.in === 'header')
    .map(
      ([key, value]) =>
        `${key}: this.options[${value.optionName ? `'${value.optionName}'` : key}]`,
    )
    .join(',\n')}}`;
  const defaultInputs = `{${optionsEntries
    .filter(([, value]) => value.in === 'input')
    .map(
      ([key, value]) =>
        `${key}: this.options[${value.optionName ? `'${value.optionName}'` : key}]`,
    )
    .join(',\n')}}`;
  const specOptions: Record<string, { schema: string }> = {
    ...Object.fromEntries(
      optionsEntries.map(([key, value]) => [value.optionName ?? key, value]),
    ),
    fetch: {
      schema: 'fetchType',
    },
    baseUrl: {
      schema: spec.servers.length
        ? `z.enum(servers).default(servers[0])`
        : 'z.string()',
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

import { parseInput, type ParseError } from './http/${spec.makeImport('parser')}';

${spec.servers.length ? `export const servers = ${JSON.stringify(spec.servers, null, 2)} as const` : ''}
const optionsSchema = z.object(${toLitObject(specOptions, (x) => x.schema)});
${spec.servers.length ? `export type Servers = typeof servers[number];` : ''}

type ${spec.name}Options = z.infer<typeof optionsSchema>;

export class ${spec.name} {
  public options: ${spec.name}Options
  constructor(options: ${spec.name}Options) {
    this.options = optionsSchema.parse(options);
  }

  async request<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.infer<(typeof schemas)[E]['schema']>,
    options?: { signal?: AbortSignal, headers?: HeadersInit },
  ) ${style.errorAsValue ? `: Promise<Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>| [never, ParseError<(typeof schemas)[E]['schema']>]>` : `: Promise<Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>>`} {
    const route = schemas[endpoint];
    const withDefaultInputs = Object.assign({}, this.#defaultInputs, input);
    const [parsedInput, parseError] = parseInput(route.schema, withDefaultInputs);
    if (parseError) {
      ${style.errorAsValue ? 'return [null as never, parseError as never] as const;' : 'throw parseError;'}
    }
    const result = await route.dispatch(parsedInput as never, {
      fetch: this.options.fetch,
      interceptors: [
        createHeadersInterceptor(() => this.defaultHeaders, options?.headers ?? {}),
        createBaseUrlInterceptor(() => this.options.baseUrl),
      ],
      signal: options?.signal,
    });
    return result as Awaited<ReturnType<(typeof schemas)[E]['dispatch']>>;
  }

  async prepare<const E extends keyof typeof schemas>(
    endpoint: E,
    input: z.infer<(typeof schemas)[E]['schema']>,
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

  get defaultHeaders() {
    return ${defaultHeaders}
  }

  get #defaultInputs() {
    return ${defaultInputs}
  }

  setOptions(options: Partial<${spec.name}Options>) {
    const validated = optionsSchema.partial().parse(options);

    for (const key of Object.keys(validated) as (keyof ${spec.name}Options)[]) {
      if (validated[key] !== undefined) {
        (this.options[key] as typeof validated[typeof key]) = validated[key]!;
      }
    }
  }
}`;
};
