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
import * as augment from '../inputs/augment.ts';
import {
  type PostAugmentOutput200,
  type PostAugmentOutput400,
} from '../outputs/post-augment.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'POST /augment': {
    schema: augment.postAugmentSchema,
    output: [
      http.Ok<PostAugmentOutput200>,
      http.BadRequest<PostAugmentOutput400>,
    ],
    toRequest(input: z.infer<typeof augment.postAugmentSchema>) {
      return toRequest(
        'POST /augment',
        json(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: ['specUrl'],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.infer<typeof augment.postAugmentSchema>,
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
