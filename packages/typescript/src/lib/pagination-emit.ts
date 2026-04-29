import type { OperationPagination } from '@sdk-it/spec';

type PaginationShape = {
  className: string;
  items: string;
  hasMore: string;
  statusCode: number;
  sameInputNames: boolean;
  initialOverride: string;
  nextPageMapping: string;
};

function describe(p: OperationPagination): PaginationShape {
  switch (p.type) {
    case 'offset':
      return {
        className: 'OffsetPagination',
        items: p.items,
        hasMore: p.hasMore,
        statusCode: p.statusCode,
        sameInputNames:
          p.limitParamName === 'limit' && p.offsetParamName === 'offset',
        initialOverride: `limit: input.${p.limitParamName}, offset: input.${p.offsetParamName}`,
        nextPageMapping: `${p.offsetParamName}: nextPageParams.offset, ${p.limitParamName}: nextPageParams.limit`,
      };
    case 'cursor':
      return {
        className: 'CursorPagination',
        items: p.items,
        hasMore: p.hasMore,
        statusCode: p.statusCode,
        sameInputNames: p.cursorParamName === 'cursor',
        initialOverride: `cursor: input.${p.cursorParamName}`,
        nextPageMapping: `${p.cursorParamName}: nextPageParams.cursor`,
      };
    case 'page':
      return {
        className: 'Pagination',
        items: p.items,
        hasMore: p.hasMore,
        statusCode: p.statusCode,
        sameInputNames:
          p.pageNumberParamName === 'page' &&
          p.pageSizeParamName === 'pageSize',
        initialOverride: `page: input.${p.pageNumberParamName}, pageSize: input.${p.pageSizeParamName}`,
        nextPageMapping: `${p.pageNumberParamName}: nextPageParams.page, ${p.pageSizeParamName}: nextPageParams.pageSize`,
      };
  }
  throw new Error(
    `Unknown pagination type: ${(p as { type: string }).type}`,
  );
}

export function paginationOperation(pagination: OperationPagination): string {
  const shape = describe(pagination);
  const initialParams = shape.sameInputNames
    ? 'input'
    : `{...input, ${shape.initialOverride}}`;
  const nextPageParams = shape.sameInputNames
    ? '...nextPageParams'
    : shape.nextPageMapping;

  return `{
      const pagination = new ${shape.className}(${initialParams}, async (nextPageParams, requestOptions) => {
        const dispatcher = new Dispatcher(options.interceptors, options.fetch);
        const result = await dispatcher.send(
          this.toRequest({...input, ${nextPageParams}}),
          this.output,
          requestOptions?.signal ?? options.signal,
        );
        if (result.status !== ${shape.statusCode}) { throw result; }
        return {
          data: result.data.${shape.items},
          meta: {
            hasMore: Boolean(result.data.${shape.hasMore}),
          },
        };
      }, { signal: options.signal });
      await pagination.getNextPage();
      return pagination
    }}`;
}
