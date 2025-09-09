type InferPage<T> = T extends Page<infer U> ? U : never;
type PaginationParams<P extends number | bigint, S extends number | bigint> = {
  page?: P;
  pageSize?: S;
};

interface Metadata {
  hasMore?: boolean;
}

type PaginationResult<T, M extends Metadata> = {
  data: T[];
  meta: M;
};

type FetchFn<
  T,
  M extends Metadata,
  P extends number | bigint,
  S extends number | bigint,
> = (input: Partial<PaginationParams<P, S>>) => Promise<PaginationResult<T, M>>;

/**
 * @experimental
 */
export class Pagination<
  T,
  M extends Metadata,
  P extends number | bigint,
  S extends number | bigint,
> {
  #meta: PaginationResult<T, M>['meta'] | null = null;
  #params: PaginationParams<P, S>;
  #currentPage: Page<T> | null = null;
  readonly #fetchFn: FetchFn<T, M, P, S>;

  constructor(
    initialParams: Partial<PaginationParams<P, S>>,
    fetchFn: FetchFn<T, M, P, S>,
  ) {
    this.#fetchFn = fetchFn;
    this.#params = { ...initialParams, page: initialParams.page };
  }

  async getNextPage() {
    const result = await this.#fetchFn(this.#params);
    this.#currentPage = new Page(result.data);
    this.#meta = result.meta;
    this.#params = {
      ...this.#params,
      page: ((this.#params.page as number) || 0 + 1) as never,
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
