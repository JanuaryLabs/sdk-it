type OffsetPaginationParams = {
  offset: number;
  limit: number;
};

interface Metadata {
  hasMore?: boolean;
}

type PaginationResult<T, M extends Metadata> = {
  data: T[];
  meta: M;
};

type FetchFn<T, M extends Metadata> = (
  input: OffsetPaginationParams,
) => Promise<PaginationResult<T, M>>;

/**
 * @experimental
 */
export class OffsetPagination<T, M extends Metadata> {
  #meta: PaginationResult<T, M>['meta'] | null = null;
  #params: OffsetPaginationParams;
  #currentPage: Page<T> | null = null;
  readonly #fetchFn: FetchFn<T, M>;

  constructor(
    initialParams: Partial<OffsetPaginationParams>,
    fetchFn: FetchFn<T, M>,
  ) {
    this.#fetchFn = fetchFn;
    this.#params = {
      limit: initialParams.limit ?? 0,
      offset: initialParams.offset ?? 0,
    };
  }

  async getNextPage() {
    const result = await this.#fetchFn(this.#params);
    this.#currentPage = new Page(result.data);
    this.#meta = result.meta;
    this.#params = {
      ...this.#params,
      offset: this.#params.offset + this.#params.limit,
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

  reset(params?: Partial<OffsetPaginationParams>) {
    this.#meta = null;
    this.#currentPage = null;
    if (params) {
      this.#params = { ...this.#params, ...params };
    } else {
      this.#params.offset = 0;
    }
    return this;
  }
}

class Page<T> {
  data: T[];
  constructor(data: T[]) {
    this.data = data;
  }
}
