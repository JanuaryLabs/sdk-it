/** How an operation pages, as the spec IR records it. Paths are dot-separated paths into the response body. */
export type Pagination =
  | {
      type: 'offset';
      offsetParamName: string;
      limitParamName: string;
      items: string;
      hasMore: string;
      statusCode: number;
      /** The offset parameter's default in the spec. */
      start?: number;
    }
  | {
      type: 'page';
      pageNumberParamName: string;
      pageSizeParamName: string;
      items: string;
      hasMore: string;
      statusCode: number;
      /** The page parameter's default in the spec. */
      start?: number;
    }
  | {
      type: 'cursor';
      cursorParamName: string;
      items: string;
      hasMore: string;
      statusCode: number;
      /** Path of the cursor that requests the next page. */
      nextCursor?: string;
    };

type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof NonNullable<T>
    ? PathValue<NonNullable<T>[K], Rest>
    : never
  : P extends keyof NonNullable<T>
    ? NonNullable<T>[P]
    : never;

/** The item type of the array at `P` in `Data`. */
export type ItemOf<Data, P extends string> =
  NonNullable<PathValue<Data, P>> extends readonly (infer I)[] ? I : never;

export interface PageControls<Data, Item> extends AsyncIterable<Item> {
  hasNextPage(): boolean;
  getNextPage(): Promise<Page<Data, Item>>;
  /** This page, then each following page. */
  iterPages(): AsyncGenerator<Page<Data, Item>>;
}

/** A page: the response body's fields, and the way to the next page. */
export type Page<Data, Item> = Data & PageControls<Data, Item>;

type FetchPage = (input: Record<string, unknown>) => Promise<ResponsePage>;

function at(data: unknown, path: string): unknown {
  let value = data;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

/**
 * The position an omitted offset or page parameter stands for: the spec's
 * default, else the first offset (0) or the first page (1).
 */
function position(sent: unknown, start: number | undefined, first: number) {
  if (typeof sent === 'number') return sent;
  return start ?? first;
}

class ResponsePage {
  readonly #input: Record<string, unknown>;
  readonly #pagination: Pagination;
  readonly #fetchPage: FetchPage;
  readonly #items: unknown[];

  constructor(
    data: object,
    input: Record<string, unknown>,
    pagination: Pagination,
    fetchPage: FetchPage,
  ) {
    Object.assign(this, data);
    this.#input = input;
    this.#pagination = pagination;
    this.#fetchPage = fetchPage;
    const items = at(data, pagination.items);
    // A spec may declare the items array nullable; a page without one is empty.
    this.#items = Array.isArray(items) ? items : [];
  }

  hasNextPage() {
    return Boolean(at(this, this.#pagination.hasMore));
  }

  async getNextPage() {
    return this.#fetchPage(this.#nextInput());
  }

  async *iterPages() {
    yield this;
    let page = this.hasNextPage() ? await this.getNextPage() : undefined;
    while (page) {
      yield page;
      page = page.hasNextPage() ? await page.getNextPage() : undefined;
    }
  }

  async *[Symbol.asyncIterator]() {
    for await (const page of this.iterPages()) {
      yield* page.#items;
    }
  }

  #nextInput(): Record<string, unknown> {
    const pagination = this.#pagination;
    switch (pagination.type) {
      case 'offset': {
        const offset = position(
          this.#input[pagination.offsetParamName],
          pagination.start,
          0,
        );
        return {
          ...this.#input,
          [pagination.offsetParamName]: offset + this.#items.length,
        };
      }
      case 'page': {
        const page = position(
          this.#input[pagination.pageNumberParamName],
          pagination.start,
          1,
        );
        return { ...this.#input, [pagination.pageNumberParamName]: page + 1 };
      }
      case 'cursor': {
        const cursor = pagination.nextCursor
          ? at(this, pagination.nextCursor)
          : undefined;
        if (typeof cursor !== 'string') {
          throw new Error(
            'The response says more pages exist but names no next cursor',
          );
        }
        return { ...this.#input, [pagination.cursorParamName]: cursor };
      }
    }
  }
}

/** Builds the Page for `data`, the body of a response to `input`. */
export function createPage(
  data: object,
  input: Record<string, unknown>,
  pagination: Pagination,
  fetchPage: FetchPage,
): ResponsePage {
  return new ResponsePage(data, input, pagination, fetchPage);
}

/**
 * The promise of a page that is also an async iterable of every item across
 * pages, so `for await (const item of client.request(…))` needs no `await`.
 */
export class PagePromise<P extends AsyncIterable<Item>, Item>
  extends Promise<P>
  implements AsyncIterable<Item>
{
  static override get [Symbol.species]() {
    return Promise;
  }

  constructor(page: Promise<P>) {
    super((resolve, reject) => {
      page.then(resolve, reject);
    });
  }

  async *[Symbol.asyncIterator]() {
    yield* await this;
  }
}
