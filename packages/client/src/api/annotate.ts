import z from 'zod';

import { Dispatcher, fetchType } from '../http/dispatcher.ts';
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
import * as annotate from '../inputs/annotate.ts';
import { type PostAnnotateOutput400 } from '../outputs/post-annotate.ts';

export default {
  'POST /annotate': {
    schema: annotate.postAnnotateSchema,
    output: [http.BadRequest<PostAnnotateOutput400>],
    toRequest(input: z.infer<typeof annotate.postAnnotateSchema>) {
      return toRequest(
        'POST /annotate',
        json(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: ['specUrl'],
          inputParams: [],
        }),
      );
    },
    dispatch(
      input: z.infer<typeof annotate.postAnnotateSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(this.toRequest(input), this.output);
    },
  },
};
