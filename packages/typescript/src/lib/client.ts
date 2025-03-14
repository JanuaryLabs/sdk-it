import { toLitObject } from '@sdk-it/core';

import type { Spec } from './sdk.ts';

export default (spec: Spec) => {
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

  return `
import { fetchType, sendRequest } from './http/send-request.ts';
import z from 'zod';
import type { Endpoints } from './endpoints.ts';
import schemas from './schemas.ts';
import {
  createBaseUrlInterceptor,
  createDefaultHeadersInterceptor,
} from './http/interceptors.ts';

${spec.servers.length ? `export const servers = ${JSON.stringify(spec.servers, null, 2)} as const` : ''}
const optionsSchema = z.object(${toLitObject(specOptions, (x) => x.schema)});
${spec.servers.length ? `export type Servers = typeof servers[number];` : ''}

type ${spec.name}Options = z.infer<typeof optionsSchema>;

export class ${spec.name} {
  public options: ${spec.name}Options
  constructor(options: ${spec.name}Options) {
    this.options = options;
  }

  async request<E extends keyof Endpoints>(
    endpoint: E,
    input: Endpoints[E]['input'],
  ): Promise<readonly [Endpoints[E]['output'], Endpoints[E]['error'] | null]> {
    const route = schemas[endpoint];
    return sendRequest(Object.assign(this.#defaultInputs, input), route, {
      fetch: this.options.fetch,
      interceptors: [
        createDefaultHeadersInterceptor(() => this.defaultHeaders),
        createBaseUrlInterceptor(() => this.options.baseUrl),
      ],
    });
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
