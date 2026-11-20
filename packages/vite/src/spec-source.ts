import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { loadSpec } from '@sdk-it/spec';

/** A spec read for one generation, and the URI of every document it was read from. */
export interface LoadedSpec {
  spec: OpenAPIObject;
  documents: readonly string[];
}

/** A source bound to a Vite root, ready to load. */
export interface ConfiguredSpec {
  /** The local file the spec starts from, when it is one. */
  readonly watchPath: string | undefined;
  load(): Promise<LoadedSpec>;
}

/** Where the spec of a generated SDK comes from. */
export interface SpecSource {
  configure(root: string): Promise<ConfiguredSpec>;
}

/** A spec at a path relative to the Vite root, or at a URL. */
export class FileSpecSource implements SpecSource {
  readonly #location: string;

  constructor(location: string) {
    this.#location = location;
  }

  async configure(root: string): Promise<ConfiguredSpec> {
    const location = this.#location;
    if (!startsWithProtocol(location)) {
      const path = join(root, location);
      return { watchPath: path, load: () => loadSpec(path) };
    }
    return {
      watchPath: location.startsWith('file:')
        ? fileURLToPath(location)
        : undefined,
      load: () => loadSpec(location),
    };
  }
}

/** A spec the Vite config holds as an object. */
export class DocumentSpecSource implements SpecSource {
  readonly #document: OpenAPIObject;

  constructor(document: OpenAPIObject) {
    this.#document = document;
  }

  async configure(): Promise<ConfiguredSpec> {
    return {
      watchPath: undefined,
      load: async () => ({
        spec: structuredClone(this.#document),
        documents: [],
      }),
    };
  }
}

/** A spec a function gives once Vite resolves its config: a location or an object. */
export class LazySpecSource implements SpecSource {
  readonly #resolve: () =>
    string | OpenAPIObject | Promise<string | OpenAPIObject>;

  constructor(
    resolve: () => string | OpenAPIObject | Promise<string | OpenAPIObject>,
  ) {
    this.#resolve = resolve;
  }

  async configure(root: string): Promise<ConfiguredSpec> {
    const resolved = await this.#resolve();
    const source =
      typeof resolved === 'string'
        ? new FileSpecSource(resolved)
        : new DocumentSpecSource(resolved);
    return source.configure(root);
  }
}

function startsWithProtocol(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url);
}
