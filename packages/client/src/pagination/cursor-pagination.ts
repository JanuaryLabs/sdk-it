type CursorPaginationParams = {
  cursor?: string;
};

interface CursorMetadata extends Metadata {
  nextCursor?: string;
}

interface Metadata {
  hasMore?: boolean;
}

type PaginationResult<T, M extends CursorMetadata> = {
  data: T[];
  meta: M;
};

type FetchFn<T, M extends CursorMetadata> = (
  input: CursorPaginationParams,
) => Promise<PaginationResult<T, M>>;

/**
 * @experimental
 */
export class CursorPagination<T, M extends CursorMetadata> {
  #meta: PaginationResult<T, M>['meta'] | null = null;
  #params: CursorPaginationParams;
  #currentPage: Page<T> | null = null;
  readonly #fetchFn: FetchFn<T, M>;

  constructor(
    initialParams: PartialNullable<CursorPaginationParams>,
    fetchFn: FetchFn<T, M>,
  ) {
    this.#fetchFn = fetchFn;
    this.#params = {
      cursor: initialParams.cursor ?? undefined,
    };
  }

  async getNextPage() {
    const result = await this.#fetchFn(this.#params);
    this.#currentPage = new Page(result.data);
    this.#meta = result.meta;
    this.#params = {
      ...this.#params,
      cursor: result.meta.nextCursor,
    };
    return this;
  }

  getCurrentPage() {
    if (!this.#currentPage) {
      throw new Error(
        'No page data available. Please call getNextPage() first.',
      );
    }
    return this.#currentPage;
  }

  get hasMore() {
    if (!this.#meta) {
      throw new Error(
        'No meta data available. Please call getNextPage() first.',
      );
    }
    return this.#meta.hasMore;
  }

  async *[Symbol.asyncIterator]() {
    for await (const page of this.iter()) {
      yield page.getCurrentPage();
    }
  }

  async *iter() {
    if (!this.#currentPage) {
      yield await this.getNextPage();
    }

    while (this.hasMore) {
      yield await this.getNextPage();
    }
  }

  get metadata() {
    if (!this.#meta) {
      throw new Error(
        'No meta data available. Please call getNextPage() first.',
      );
    }
    return this.#meta;
  }
}

class Page<T> {
  data: T[];
  constructor(data: T[]) {
    this.data = data;
  }
}

type PartialNullable<T> = {
  [K in keyof T]?: T[K] | null;
};
