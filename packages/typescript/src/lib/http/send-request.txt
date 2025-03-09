import z from 'zod';

import { handleError, parseResponse } from './parse-response.ts';
import { parse } from './parser.ts';

export interface RequestSchema {
  schema: z.ZodType;
  toRequest: (
    input: any,
    init: { baseUrl: string; headers?: Partial<Record<string, string>> },
  ) => any;
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
    baseUrl: string;
    fetch?: z.infer<typeof fetchType>;
    headers?: Partial<Record<string, string>>;
  },
) {
  const [parsedInput, parseError] = parse(route.schema, input);
  if (parseError) {
    return [null as never, { ...parseError, kind: 'parse' } as never] as const;
  }
  const request = route.toRequest(parsedInput as never, {
    headers: options.headers,
    baseUrl: options.baseUrl,
  });
  const response = await (options.fetch ?? fetch)(request);
  if (response.ok) {
    const data = await parseResponse(response);
    return [data as never, null] as const;
  }
  const error = await handleError(response);
  return [null as never, { ...error, kind: 'response' }] as const;
}
