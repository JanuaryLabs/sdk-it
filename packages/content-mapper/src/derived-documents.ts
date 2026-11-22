import { isErrno } from '@zukhruf/fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type OpenApiDefinition, generateDocument } from '@sdk-it/openapi';

/** A derived document as its last refresh left it. */
export type DerivedState =
  | {
      readonly kind: 'document';
      /** The document's text, as written to its file. */
      readonly text: string;
      /** The definition module and every file of the backend the analysis read. */
      readonly watched: readonly string[];
    }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly watched: readonly string[];
    };

/**
 * The documents a tsconfig derives (`contentMappers[].options.derived`):
 * each one's path, relative to the tsconfig, and the backend's OpenAPI
 * definition module that produces it. A refresh imports the definition,
 * generates the document and rewrites its file when the bytes differ, so
 * every reader renders the document the backend's code has now.
 */
export class DerivedDocuments {
  readonly #definitions = new Map<string, string>();
  readonly #states = new Map<string, DerivedState>();
  #imports = 0;

  constructor(directory: string, derived: Readonly<Record<string, string>>) {
    for (const [document, definition] of Object.entries(derived)) {
      this.#definitions.set(
        resolve(directory, document),
        resolve(directory, definition),
      );
    }
  }

  /** The documents this tsconfig derives, by absolute path. */
  get documents(): string[] {
    return [...this.#definitions.keys()];
  }

  /** The state of `document` after its last refresh. */
  state(document: string): DerivedState | undefined {
    return this.#states.get(document);
  }

  /** Refreshes every derived document. */
  async refreshAll(): Promise<void> {
    for (const document of this.#definitions.keys()) {
      await this.refresh(document);
    }
  }

  /** Imports the definition of `document`, generates the document, and writes it when it changed. */
  async refresh(document: string): Promise<DerivedState> {
    const definitionPath = this.#definitions.get(document);
    if (!definitionPath) {
      throw new Error(
        `${document} is not a derived document of this tsconfig.`,
      );
    }
    let state: DerivedState;
    try {
      // A query makes each refresh evaluate the definition module again, so an
      // edit to it is read; the files the analysis reads are read anew anyway.
      const loaded = await import(
        `${pathToFileURL(definitionPath).href}?refresh=${++this.#imports}`
      );
      const definition: OpenApiDefinition = loaded.default;
      const { document: generated, sourceFiles } =
        await generateDocument(definition);
      const text = `${JSON.stringify(generated, null, 2)}\n`;
      await writeWhenChanged(document, text);
      state = {
        kind: 'document',
        text,
        watched: [definitionPath, ...sourceFiles],
      };
    } catch (error) {
      state = {
        kind: 'failed',
        message: Error.isError(error) ? error.message : String(error),
        watched: [definitionPath],
      };
    }
    this.#states.set(document, state);
    return state;
  }
}

/** Writes `text` to `path` through a temporary file and a rename, unless the file holds it already. */
async function writeWhenChanged(path: string, text: string): Promise<void> {
  let current: string | undefined;
  try {
    current = await readFile(path, 'utf8');
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) {
      throw error;
    }
  }
  if (current === text) {
    return;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}
