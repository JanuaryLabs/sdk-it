import { API } from '@typescript/native/sync';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type OpenApiDefinition, generateDocument } from '@sdk-it/openapi';

import { isRecord } from './is-record.js';

/** A derived document as its backend produces it now. */
export type Derivation =
  | {
      readonly kind: 'derived';
      /** The document's text, as the committed file holds it when fresh. */
      readonly text: string;
      /** The definition module and every file of the backend the analysis read. */
      readonly sources: readonly string[];
    }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly sources: readonly string[];
    };

/**
 * A document that a tsconfig declares derived from a backend's OpenAPI
 * definition module (`contentMappers[].options.derived`). Every reader and
 * the writer derive it through `derive`, so the committed bytes are what the
 * readers type and run against. Deriving writes nothing.
 */
export class DerivedDocument {
  /** The committed document. */
  readonly path: string;
  /** The backend's definition module, whose default export is `defineOpenApi(...)`. */
  readonly definition: string;

  constructor(path: string, definition: string) {
    this.path = path;
    this.definition = definition;
  }

  /** Each document that `tsconfig`'s `contentMappers[].options.derived` declares. */
  static async declaredBy(tsconfig: string): Promise<DerivedDocument[]> {
    using api = new API();
    return declaredIn(
      dirname(tsconfig),
      derivedOption(api.readConfigFile(tsconfig).config),
    );
  }

  /**
   * The declaration that names `path`: the first tsconfig*.json, from the
   * document's folder up to its package root, whose `derived` entry names it.
   * A host with no tsconfig of its own, Vite or Node, finds it this way.
   */
  static async at(path: string): Promise<DerivedDocument | undefined> {
    let api: API | undefined;
    try {
      for (let directory = dirname(path); ; directory = dirname(directory)) {
        const tsconfigs = (await readdir(directory))
          .filter((name) => /^tsconfig.*\.json$/.test(name))
          .sort();
        for (const name of tsconfigs) {
          const tsconfig = join(directory, name);
          // A tsconfig that never says "derived" declares no derived document, so
          // a plain document's import starts no TypeScript process.
          if (!(await readFile(tsconfig, 'utf8')).includes('"derived"')) {
            continue;
          }
          api ??= new API();
          const found = declaredIn(
            directory,
            derivedOption(api.readConfigFile(tsconfig).config),
          ).find((document) => document.path === path);
          if (found) {
            return found;
          }
        }
        if (
          existsSync(join(directory, 'package.json')) ||
          dirname(directory) === directory
        ) {
          return undefined;
        }
      }
    } finally {
      api?.[Symbol.dispose]();
    }
  }

  /** The document as the backend's code produces it now. */
  async derive(): Promise<Derivation> {
    try {
      // A query makes each derivation evaluate the definition module again, so
      // an edit to it is read; the files the analysis reads are read anew anyway.
      const loaded = await import(
        `${pathToFileURL(this.definition).href}?derive=${randomUUID()}`
      );
      const definition: OpenApiDefinition = loaded.default;
      const { document, sourceFiles } = await generateDocument(definition);
      return {
        kind: 'derived',
        text: `${JSON.stringify(document, null, 2)}\n`,
        sources: [this.definition, ...sourceFiles],
      };
    } catch (error) {
      return {
        kind: 'failed',
        message: Error.isError(error) ? error.message : String(error),
        sources: [this.definition],
      };
    }
  }
}

/** The documents of a `derived` option, each path relative to `directory`. */
export function declaredIn(
  directory: string,
  derived: Readonly<Record<string, string>> | undefined,
): DerivedDocument[] {
  return Object.entries(derived ?? {}).map(
    ([document, definition]) =>
      new DerivedDocument(
        resolve(directory, document),
        resolve(directory, definition),
      ),
  );
}

/** The `derived` option of a tsconfig's content mapper entry, when it has one. */
function derivedOption(config: unknown): Record<string, string> | undefined {
  if (!isRecord(config) || !Array.isArray(config['contentMappers'])) {
    return undefined;
  }
  for (const entry of config['contentMappers']) {
    const options = isRecord(entry) ? entry['options'] : undefined;
    const derived = isRecord(options) ? options['derived'] : undefined;
    if (
      isRecord(derived) &&
      Object.values(derived).every((value) => typeof value === 'string')
    ) {
      return Object.fromEntries(
        Object.entries(derived).map(([key, value]) => [key, String(value)]),
      );
    }
  }
  return undefined;
}
