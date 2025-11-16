import z from 'zod';

import {
  Dispatcher,
  type InstanceType,
  fetchType,
} from '../http/dispatcher.ts';
import {
  type Interceptor,
  createBaseUrlInterceptor,
  createHeadersInterceptor,
} from '../http/interceptors.ts';
import { buffered, chunked } from '../http/parse-response.ts';
import {
  type HeadersInit,
  empty,
  formdata,
  json,
  toRequest,
  urlencoded,
} from '../http/request.ts';
import * as http from '../http/response.ts';
import * as fetch from '../inputs/fetch.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'GET /fetch': {
    schema: fetch.getFetchSchema,
    output: [http.Ok<outputs.GetFetch>, http.BadRequest<outputs.GetFetch400>],
    toRequest(input: z.input<typeof fetch.getFetchSchema>) {
      return toRequest(
        'GET /fetch',
        empty(input, {
          inputHeaders: [],
          inputQuery: ['url'],
          inputBody: [],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof fetch.getFetchSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(
        this.toRequest(input),
        this.output,
        options?.signal,
      );
    },
  },
};
