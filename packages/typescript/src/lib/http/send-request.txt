import z from 'zod';

import type { Interceptor } from './interceptors.ts';
import { handleError, parseResponse } from './parse-response.ts';
import { parse } from './parser.ts';

export interface RequestSchema {
  schema: z.ZodType;
  toRequest: (input: any) => Request;
}

export const fetchType = z
  .function()
  .args(z.instanceof(Request))
  .returns(z.promise(z.instanceof(Response)))
  .optional();

export async function sendRequest(
  input: any,
  route: RequestSchema,
  options: {
    fetch?: z.infer<typeof fetchType>;
    interceptors?: Interceptor[];
  },
) {
  const { interceptors = [] } = options;
  const [parsedInput, parseError] = parse(route.schema, input);
  if (parseError) {
    return [null as never, { ...parseError, kind: 'parse' } as never] as const;
  }

  let request = route.toRequest(parsedInput as never);
  for (const interceptor of interceptors) {
    if (interceptor.before) {
      request = await interceptor.before(request);
    }
  }

  let response = await (options.fetch ?? fetch)(request);

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i];
    if (interceptor.after) {
      response = await interceptor.after(response.clone());
    }
  }

  if (response.ok) {
    const data = await parseResponse(response);
    return [data as never, null] as const;
  }
  const error = await handleError(response);
  return [null as never, { ...error, kind: 'response' }] as const;
}
