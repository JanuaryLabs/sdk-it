import { Mutex } from '@zukhruf/mutex';
import { SqliteStore } from '@zukhruf/mutex/sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The folder an SDK is generated into. Every process on the host that
 * generates into it, such as a dev server and a build at once, holds one lock
 * for it, so no two generations write its files at the same time. A process
 * does not generate again the spec it last wrote there.
 */
export class OutputFolder {
  static readonly #mutex = new Mutex(
    new SqliteStore(join(tmpdir(), 'sdk-it', 'output-locks'), {
      clock: globalThis,
    }),
  );
  /** The hash of the spec this process last wrote into each folder. */
  static readonly #written = new Map<string, string>();
  readonly #path: string;

  constructor(output: string) {
    this.#path = resolve(output);
  }

  generate(hash: string, generate: () => Promise<void>): Promise<void> {
    return OutputFolder.#mutex.acquire(this.#path, async () => {
      if (OutputFolder.#written.get(this.#path) === hash) return;
      await generate();
      OutputFolder.#written.set(this.#path, hash);
    });
  }
}
