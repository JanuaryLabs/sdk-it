import pMemoize from 'p-memoize';

import {
  type DocumentParser,
  JsonParser,
  YamlParser,
} from './document-parser.js';
import {
  type DocumentSource,
  FileSource,
  HttpSource,
} from './document-source.js';
import { DocumentParseError, DocumentReadError } from './errors.js';

export interface DocumentsOptions {
  /** Tried in order; the first that can read a URL reads it. */
  sources: readonly DocumentSource[];
  /** The ones that know a URL's extension are tried in order; for an extension none knows, every parser is. */
  parsers: readonly [DocumentParser, ...DocumentParser[]];
}

/** The documents of one spec, each read and parsed once by URL. */
export class Documents {
  readonly #sources: readonly DocumentSource[];
  readonly #parsers: readonly [DocumentParser, ...DocumentParser[]];
  readonly #requested = new Set<string>();
  readonly #read = pMemoize((url: URL) => this.#readAndParse(url), {
    cacheKey: ([url]) => url.href,
  });

  constructor(options: DocumentsOptions) {
    this.#sources = options.sources;
    this.#parsers = options.parsers;
  }

  /** Reads `file:` and `http(s):` URLs and parses JSON and YAML. */
  static standard() {
    return new Documents({
      sources: [new FileSource(), new HttpSource()],
      parsers: [new JsonParser(), new YamlParser()],
    });
  }

  load(url: URL): Promise<unknown> {
    this.#requested.add(url.href);
    return this.#read(url);
  }

  /** The URI of every document asked for, in the order each first was, including one that failed to load. */
  uris(): string[] {
    return [...this.#requested];
  }

  async #readAndParse(url: URL) {
    const source = this.#sources.find((candidate) => candidate.canRead(url));
    if (!source) {
      throw new DocumentReadError(url, `No source reads ${url.protocol} URLs`);
    }
    return this.#parse(url, await source.read(url));
  }

  #parse(url: URL, text: string) {
    const matching = this.#parsers.filter((parser) => parser.canParse(url));
    let failure: unknown;
    for (const parser of matching.length ? matching : this.#parsers) {
      try {
        return parser.parse(text);
      } catch (error) {
        failure = error;
      }
    }
    throw new DocumentParseError(url, { cause: failure });
  }
}
