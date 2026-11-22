import { API } from '@typescript/native/sync';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { DerivedDocuments } from './derived-documents.js';

/**
 * The derived documents of the tsconfig that declares `document` derived
 * (`contentMappers[].options.derived`): the first tsconfig*.json, from the
 * document's folder up to its package root, whose entry names it. A host
 * with no tsconfig of its own, Vite or Node, finds the declaration this way;
 * TypeScript hands the content mapper its options itself.
 */
export async function derivedDocumentsOf(
  document: string,
): Promise<DerivedDocuments | undefined> {
  let api: API | undefined;
  try {
    for (let directory = dirname(document); ; directory = dirname(directory)) {
      const tsconfigs = (await readdir(directory))
        .filter((name) => /^tsconfig.*\.json$/.test(name))
        .sort();
      for (const name of tsconfigs) {
        const path = join(directory, name);
        // A tsconfig that never says "derived" declares no derived document, so
        // a plain document's import starts no TypeScript process.
        if (!(await readFile(path, 'utf8')).includes('"derived"')) {
          continue;
        }
        api ??= new API();
        const derived = derivedOption(api.readConfigFile(path).config);
        if (
          derived &&
          Object.keys(derived).some(
            (key) => resolve(directory, key) === document,
          )
        ) {
          return new DerivedDocuments(directory, derived);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
