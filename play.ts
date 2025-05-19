/* eslint-disable @nx/enforce-module-boundaries */
// pagination = await pagination.getNextPage();
// console.dir(pagination.getPageData(), { depth: 2 });
// pagination = await pagination.getNextPage();
// console.dir(pagination.getPageData());
import { SdkIt } from './packages/client/dist/index.js';

const client = new SdkIt({
  baseUrl: 'http://localhost:3000',
});

type PaginationParams = {
  page: number;
  pageSize: number;
};

interface Metadata {
  hasMore: boolean;
}

type PaginationResult<T, M extends Metadata> = {
  data: T[];
  meta: M;
};

type FetchFn<T, M extends Metadata> = (
  input: PaginationParams,
) => Promise<PaginationResult<T, M>>;
class Pagination<T, M extends Metadata> {
  #meta: PaginationResult<T, M>['meta'] | null = null;
  #params: PaginationParams;
  #currentPage: Page<T> | null = null;
  readonly #fetchFn: FetchFn<T, M>;

  constructor(initialParams: PaginationParams, fetchFn: FetchFn<T, M>) {
    this.#fetchFn = fetchFn;
    this.#params = initialParams;
  }

  async getNextPage() {
    const result = await this.#fetchFn(this.#params);
    this.#currentPage = new Page(result.data);
    this.#meta = result.meta;
    this.#params = {
      ...this.#params,
      page: this.#params.page + 1,
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

const input = { page: 1, pageSize: 2 };
const pagination = new Pagination(input, async (input) => {
  // How about we return meta in case the server didn't and use that meta instead of modifying the params.
  const result = await client.request('GET /operations', input);
  return {
    data: result.data.operations,
    meta: {
      ...result.data.pagination,
      hasMore: result.data.pagination.hasNextPage,
    },
  };
});

// await pagination.getNextPage();
// console.log(pagination.getCurrentPage());
// await pagination.getNextPage();
// console.log(pagination.getCurrentPage());
// await pagination.getNextPage();
// console.log(pagination.getCurrentPage());

for await (const page of pagination) {
  console.dir(page);
}

console.log('hasMore', pagination.metadata);
// import { OpenAI } from 'openai';
// const openai = await new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// })
// const stores = await openai.vectorStores.list()
// const b = await openai.getNextPage()
