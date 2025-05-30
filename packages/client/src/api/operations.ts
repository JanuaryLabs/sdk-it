import z from 'zod';

import { Dispatcher, fetchType } from '../http/dispatcher.ts';
import { type Interceptor } from '../http/interceptors.ts';
import { empty, toRequest } from '../http/request.ts';
import * as http from '../http/response.ts';
import * as operations from '../inputs/operations.ts';
import {
  type GetOperationsOutput,
  type GetOperationsOutput400,
} from '../outputs/get-operations.ts';
import { Pagination } from '../pagination/index.ts';

export default {
  'GET /operations': {
    schema: operations.getOperationsSchema,
    output: [
      http.Ok<GetOperationsOutput>,
      http.BadRequest<GetOperationsOutput400>,
    ],
    toRequest(input: z.infer<typeof operations.getOperationsSchema>) {
      return toRequest(
        'GET /operations',
        empty(input, {
          inputHeaders: [],
          inputQuery: ['page', 'pageSize'],
          inputBody: [],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.infer<typeof operations.getOperationsSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
      },
    ) {
      const pagination = new Pagination(input, async (nextPageParams) => {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const result = await dispatcher.send(
          this.toRequest({ ...input, ...nextPageParams }),
          this.output,
        );

        return {
          data: result.data.operations,
          meta: {
            hasMore: Boolean(result.data.pagination.hasNextPage),
          },
        };
      });
      await pagination.getNextPage();
      return pagination;
    },
  },
};
