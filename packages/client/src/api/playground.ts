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
import * as playground from '../inputs/playground.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'POST /playground': {
    schema: playground.postPlaygroundSchema,
    output: [
      http.Ok<outputs.PostPlayground>,
      http.BadRequest<outputs.PostPlayground400>,
    ],
    toRequest(input: z.infer<typeof playground.postPlaygroundSchema>) {
      return toRequest(
        'POST /playground',
        formdata(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: ['specFile'],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.infer<typeof playground.postPlaygroundSchema>,
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
