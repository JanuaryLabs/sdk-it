import { titlecase } from 'stringcase';

import { toLitObject } from '@sdk-it/core';

import type { Spec } from './sdk.ts';

export default (spec: Spec) => {
  const specOptions: Record<string, { schema: string }> = {
    ...(spec.options ?? {}),
    fetch: {
      schema:
        'z.function().args(z.instanceof(Request)).returns(z.promise(z.instanceof(Response))).optional()',
    },
    baseUrl: {
      schema: `z.enum(servers).default(servers[0])`,
    },
  };
  if (spec.securityScheme) {
    specOptions['token'] = { schema: 'z.string().optional()' };
  }
  const defaultHeaders = spec.securityScheme
    ? `{Authorization: \`${titlecase(spec.securityScheme.bearerAuth.scheme)} \${this.options.token}\`}`
    : `{}`;

  return `

import z from 'zod';
import type { Endpoints } from './endpoints';
import schemas from './schemas';
import { parse } from './parser';
import { handleError, parseResponse } from './client';

      const servers = ${JSON.stringify(spec.servers || [], null, 2)} as const;
      const optionsSchema = z.object(${toLitObject(specOptions, (x) => x.schema)});
      type ${spec.name}Options = z.infer<typeof optionsSchema>;
    export class ${spec.name} {

      constructor(public options: ${spec.name}Options) {}

  async request<E extends keyof Endpoints>(
    endpoint: E,
    input: Endpoints[E]['input'],
  ): Promise<readonly [Endpoints[E]['output'], Endpoints[E]['error'] | null]> {
      const route = schemas[endpoint];
      const [parsedInput, parseError] = parse(route.schema, input);
      if (parseError) {
        return [
          null as never,
          { ...parseError, kind: 'parse' } as never,
        ] as const;
      }
      const request = route.toRequest(parsedInput as never, {
        headers: this.defaultHeaders,
        baseUrl: this.options.baseUrl,
      });
      const response = await (this.options.fetch ?? fetch)(request);
      if (response.ok) {
        const data = await parseResponse(response);
        return [data as Endpoints[E]['output'], null] as const;
      }
      const error = await handleError(response);
      return [null as never, { ...error, kind: 'response' }] as const;
  }

      get defaultHeaders() {
        return ${defaultHeaders}
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
