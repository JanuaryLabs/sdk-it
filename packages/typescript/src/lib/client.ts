import { titlecase } from 'stringcase';

import { toLitObject } from '@sdk-it/core';

import type { Spec } from './sdk.ts';

export default (spec: Spec) => {
  const specOptions: Record<string, { schema: string }> = {
    ...(spec.options ?? {}),
    fetch: {
      schema: 'fetchType',
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
import { fetchType, sendRequest } from './http/send-request.ts';
import z from 'zod';
import type { Endpoints } from './endpoints.ts';
import schemas from './schemas.ts';

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
      return sendRequest(input, route, {
        baseUrl: this.options.baseUrl,
        fetch: this.options.fetch,
        headers: this.defaultHeaders,
      });
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
