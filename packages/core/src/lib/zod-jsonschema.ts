import { Worker } from 'node:worker_threads';

import type {
  Binding,
  EvaluationReply,
  EvaluationRequest,
} from './zod-evaluation-protocol.js';
import type { ConvertedSchema } from './zod-to-json-schema.js';

export type { ConvertedSchema } from './zod-to-json-schema.js';

type Request<R = EvaluationRequest> = R extends unknown ? Omit<R, 'id'> : never;

/** How a request waiting for its reply ends. */
interface Settlement {
  resolve(reply: EvaluationReply): void;
  reject(error: unknown): void;
}

/** The thread takes requests. */
class Open {}

/** The thread failed or is disposed: every request fails with `error`. */
class Closed {
  readonly error: unknown;
  constructor(error: unknown) {
    this.error = error;
  }
}

/**
 * Resolves and loads the modules an `against` reads, and evaluates it, in a
 * thread of its own that resolves with the analyzed project's
 * `customConditions`, as TypeScript does. Dispose it once analysis is done:
 * it owns the thread.
 */
export class ZodEvaluator implements Disposable {
  #worker: Worker;
  #pending = new Map<number, Settlement>();
  #next = 0;
  #state: Open | Closed = new Open();

  constructor(options: { conditions: readonly string[] }) {
    this.#worker = new Worker(new URL('./zod-evaluation.js', import.meta.url), {
      execArgv: [
        // import.meta.resolve takes a parent URL only behind this flag.
        '--experimental-import-meta-resolve',
        ...options.conditions.map((condition) => `--conditions=${condition}`),
        // The flag above and stripTypeScriptTypes warn that they are experimental.
        '--disable-warning=ExperimentalWarning',
      ],
    });
    this.#worker.unref();
    this.#worker.on('message', (reply: EvaluationReply) => {
      this.#settle(reply.id)?.resolve(reply);
    });
    this.#worker.on('error', (error) => this.#fail(error));
    this.#worker.on('exit', (code) =>
      this.#fail(
        new Error(`The zod evaluation thread exited with code ${code}`),
      ),
    );
  }

  /**
   * The URL of the module `specifier` names when the module at `referrer` (a
   * URL) imports it, resolved once for each pair.
   */
  async resolve(specifier: string, referrer: string): Promise<string> {
    const reply = await this.#send({ kind: 'resolve', specifier, referrer });
    if (reply.kind !== 'resolved') {
      throw new Error(`Expected a resolved URL, got ${reply.kind}`);
    }
    return reply.url;
  }

  /** Converts the zod schema an `against` expression builds. */
  async evaluate(
    against: string,
    imports: readonly Binding[] = [],
  ): Promise<ConvertedSchema> {
    const reply = await this.#send({ kind: 'evaluate', against, imports });
    if (reply.kind !== 'evaluated') {
      throw new Error(`Expected an evaluated schema, got ${reply.kind}`);
    }
    return reply.result;
  }

  /** Loads each binding as `evaluate` would, failing on one that does not load. */
  async load(imports: readonly Binding[]): Promise<void> {
    await this.#send({ kind: 'load', imports });
  }

  async #send(request: Request): Promise<EvaluationReply> {
    for (const binding of 'imports' in request ? request.imports : []) {
      if (!URL.canParse(binding.from)) {
        throw new Error(
          `The import ${binding.import} is from ${binding.from}, which is not a module URL. Pass ZodEvaluator.resolve(specifier, referrer) or pathToFileURL(path).href.`,
        );
      }
    }
    if (this.#state instanceof Closed) {
      throw this.#state.error;
    }
    const id = this.#next++;
    const { promise, resolve, reject } =
      Promise.withResolvers<EvaluationReply>();
    if (this.#pending.size === 0) this.#worker.ref();
    this.#pending.set(id, { resolve, reject });
    this.#worker.postMessage({ ...request, id });
    const reply = await promise;
    if (reply.kind === 'failed') {
      throw reply.error;
    }
    return reply;
  }

  #settle(id: number) {
    const pending = this.#pending.get(id);
    this.#pending.delete(id);
    if (this.#pending.size === 0) this.#worker.unref();
    return pending;
  }

  #fail(error: unknown) {
    if (this.#state instanceof Closed) {
      return;
    }
    this.#state = new Closed(error);
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id)?.reject(error);
    }
  }

  [Symbol.dispose]() {
    this.#fail(new Error('The zod evaluator is disposed'));
    void this.#worker.terminate();
  }
}
