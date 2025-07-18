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
  createUrl,
  empty,
  formdata,
  json,
  toRequest,
  urlencoded,
} from '../http/request.ts';
import * as http from '../http/response.ts';
import * as generate from '../inputs/generate.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'POST /generate': {
    schema: generate.postGenerateSchema,
    output: [
      { type: http.Ok<outputs.PostGenerate>, parser: chunked },
      http.BadRequest<outputs.PostGenerate400>,
    ],
    toRequest(input: z.infer<typeof generate.postGenerateSchema>) {
      return toRequest(
        'POST /generate',
        formdata(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: ['specFile'],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.infer<typeof generate.postGenerateSchema>,
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
