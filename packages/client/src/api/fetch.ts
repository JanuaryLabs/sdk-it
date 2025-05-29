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
import { ParseError } from '../http/parser.ts';
import {
  type HeadersInit,
  createUrl,
  empty,
  formdata,
  json,
  toRequest,
  urlencoded,
} from '../http/request.ts';
import { BadRequest } from '../http/response.ts';
import * as http from '../http/response.ts';
import * as fetch from '../inputs/fetch.ts';
import {
  type GetFetchOutput,
  type GetFetchOutput400,
} from '../outputs/get-fetch.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'GET /fetch': {
    schema: fetch.getFetchSchema,
    output: [http.Ok<GetFetchOutput>, http.BadRequest<GetFetchOutput400>],
    toRequest(input: z.infer<typeof fetch.getFetchSchema>) {
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
      input: z.infer<typeof fetch.getFetchSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      const result = await dispatcher.send(this.toRequest(input), this.output);
      return result.data;
    },
  },
};
