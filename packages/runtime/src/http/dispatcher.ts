import { z } from 'zod';

import { type Interceptor } from './interceptors.ts';
import { buffered } from './parse-response.ts';
import { type RequestConfig } from './request.ts';
import {
  APIError,
  APIResponse,
  type RebindSuccessPayload,
  type StatusRange,
  type SuccessfulResponse,
} from './response.ts';
import { type SSEListener } from './sse.ts';

export type Unionize<T> = T extends [infer Single extends OutputType]
  ? InstanceType<Single>
  : T extends readonly [...infer Tuple extends OutputType[]]
    ? { [I in keyof Tuple]: InstanceType<Tuple[I]> }[number]
    : never;

export type InstanceType<T> =
  T extends Type<infer U>
    ? U
    : T extends { type: Type<infer U> }
      ? U
      : T extends Array<unknown>
        ? Unionize<T>
        : never;

type ResponseData<T extends OutputType[]> =
  Extract<InstanceType<T>, SuccessfulResponse> extends SuccessfulResponse<
    infer P
  >
    ? P
    : unknown;

type ResponseMapper<T extends OutputType[], R> = (data: ResponseData<T>) => R;

export interface Type<T> {
  new (...args: any[]): T;
}
export type Parser = (
  response: Response,
) => Promise<unknown> | ReadableStream<any> | SSEListener;
/** An output that `range` declares reads every status of the range that no exact output declares. */
export type OutputType =
  | Type<APIResponse>
  | { parser: Parser; type: Type<APIResponse>; range?: StatusRange };

// Bare z.custom (no predicate) on purpose: Request/Response from another
// realm (undici vs global fetch) fail instanceof checks. The output is
// typed as a Promise directly — zod 4 deprecated z.promise.
export const fetchType = z
  .function({
    input: [z.custom<Request>()],
    output: z.custom<Promise<Response>>(),
  })
  .optional();

/** Reads the body of a status the operation declares no output for. */
const undeclared: Parser = buffered();

export async function parse<T extends OutputType[]>(
  outputs: T,
  response: Response,
): Promise<Extract<Unionize<T>, SuccessfulResponse<unknown>>>;
export async function parse<T extends OutputType[], R>(
  outputs: T,
  response: Response,
  mapper: ResponseMapper<T, R>,
): Promise<
  RebindSuccessPayload<Extract<Unionize<T>, SuccessfulResponse<unknown>>, R>
>;
export async function parse(
  outputs: OutputType[],
  response: Response,
  mapper?: (data: unknown) => unknown,
): Promise<APIResponse> {
  const declared = match(outputs, response.status);
  const output = declared ? typeOf(declared) : null;
  const parser =
    declared && 'parser' in declared ? declared.parser : undeclared;

  if (response.ok) {
    const data = await parser(response);
    const mapped = mapper ? mapper(data) : data;
    const success =
      output && isTypeOf(output, APIResponse) ? output : APIResponse;
    return success.create(response.status, response.headers, mapped);
  }

  const failure = output && isTypeOf(output, APIError) ? output : APIError;
  throw failure.create(
    response.status,
    response.headers,
    await parser(response),
  );
}

// OpenAPI 3.2 Responses Object: an explicit code takes precedence over the
// range that covers it.
function match(outputs: OutputType[], status: number) {
  const range = `${Math.trunc(status / 100)}XX`;
  return (
    outputs.find(
      (output) => !('range' in output) && statusOf(output) === status,
    ) ?? outputs.find((output) => 'range' in output && output.range === range)
  );
}

function typeOf(output: OutputType) {
  return 'parser' in output ? output.type : output;
}

function statusOf(output: OutputType) {
  const type = typeOf(output);
  return isTypeOf(type, APIResponse) || isTypeOf(type, APIError)
    ? type.status
    : undefined;
}

export function isTypeOf<T extends Type<APIResponse>>(
  instance: any,
  baseType: T,
): instance is T {
  return (
    instance === baseType ||
    Object.prototype.isPrototypeOf.call(baseType, instance)
  );
}

export class Dispatcher {
  #interceptors: Interceptor[] = [];
  #fetch: z.infer<typeof fetchType>;
  constructor(interceptors: Interceptor[], fetch?: z.infer<typeof fetchType>) {
    this.#interceptors = interceptors;
    this.#fetch = fetch;
  }

  async send<T extends OutputType[]>(
    config: RequestConfig,
    outputs: T,
    signal?: AbortSignal,
  ): Promise<Extract<Unionize<T>, SuccessfulResponse<unknown>>>;
  async send<T extends OutputType[], R>(
    config: RequestConfig,
    outputs: T,
    signal: AbortSignal | undefined,
    mapper: ResponseMapper<T, R>,
  ): Promise<
    RebindSuccessPayload<Extract<Unionize<T>, SuccessfulResponse<unknown>>, R>
  >;
  async send<T extends OutputType[], R = ResponseData<T>>(
    config: RequestConfig,
    outputs: T,
    signal?: AbortSignal,
    mapper?: ResponseMapper<T, R>,
  ) {
    for (const interceptor of this.#interceptors) {
      if (interceptor.before) {
        config = await interceptor.before(config);
      }
    }

    const init =
      signal === undefined ? config.init : { ...config.init, signal };

    let response = await (this.#fetch ?? fetch)(new Request(config.url, init));

    for (const interceptor of this.#interceptors.toReversed()) {
      if (interceptor.after) {
        response = await interceptor.after(response.clone());
      }
    }

    if (mapper) {
      return await parse(outputs, response, mapper);
    }
    return await parse(outputs, response);
  }
}
