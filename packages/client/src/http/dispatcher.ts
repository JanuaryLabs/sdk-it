import z from 'zod';

import { type Interceptor } from '../http/interceptors.ts';
import { type RequestConfig } from '../http/request.ts';
import { buffered } from './parse-response.ts';
import {
  APIError,
  APIResponse,
  type RebindSuccessPayload,
  type SuccessfulResponse,
} from './response.ts';

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
) => Promise<unknown> | ReadableStream<any>;
export type OutputType =
  | Type<APIResponse>
  | { parser: Parser; type: Type<APIResponse> };

export const fetchType = z
  .function()
  .args(z.instanceof(Request))
  .returns(z.promise(z.instanceof(Response)))
  .optional();

export async function parse<T extends OutputType[], R = ResponseData<T>>(
  outputs: T,
  response: Response,
  mapper: ResponseMapper<T, R>,
) {
  let output: typeof APIResponse | null = null;
  let parser: Parser = buffered;
  for (const outputType of outputs) {
    if ('parser' in outputType) {
      parser = outputType.parser;
      if (isTypeOf(outputType.type, APIResponse)) {
        if (response.status === outputType.type.status) {
          output = outputType.type;
          break;
        }
      }
    } else if (isTypeOf(outputType, APIResponse)) {
      if (response.status === outputType.status) {
        output = outputType;
        break;
      }
    }
  }

  if (response.ok) {
    const apiresponse = (output || APIResponse).create(
      response.status,
      response.headers,
      mapper((await parser(response)) as ResponseData<T>),
    );

    return apiresponse as RebindSuccessPayload<
      Extract<InstanceType<T>, SuccessfulResponse<unknown>>,
      R
    >;
  }

  throw (output || APIError).create(
    response.status,
    response.headers,
    await parser(response),
  );
}

export function isTypeOf<T extends Type<APIResponse>>(
  instance: any,
  baseType: T,
): instance is T {
  if (instance === baseType) {
    return true;
  }
  const prototype = Object.getPrototypeOf(instance);
  if (prototype === null) {
    return false;
  }
  return isTypeOf(prototype, baseType);
}

export class Dispatcher {
  #interceptors: Interceptor[] = [];
  #fetch: z.infer<typeof fetchType>;
  constructor(interceptors: Interceptor[], fetch?: z.infer<typeof fetchType>) {
    this.#interceptors = interceptors;
    this.#fetch = fetch;
  }

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

    let response = await (this.#fetch ?? fetch)(
      new Request(config.url, config.init),
      {
        ...config.init,
        signal: signal,
      },
    );

    for (let i = this.#interceptors.length - 1; i >= 0; i--) {
      const interceptor = this.#interceptors[i];
      if (interceptor.after) {
        response = await interceptor.after(response.clone());
      }
    }

    return await parse(
      outputs,
      response,
      mapper ?? ((data: ResponseData<T>) => data as unknown as R),
    );
  }
}
