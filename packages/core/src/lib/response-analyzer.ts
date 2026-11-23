import type { Node } from '@typescript/native/ast';

import type { TypeDeriver } from './deriver.js';
import type { ResponseItem } from './paths.js';
import type { ThrowSite, ThrownErrorReader } from './thrown.js';
import type { ResponseScope } from './utils.js';

/** What a value the scope's handler returns sends, such as `c.json(body, 201)`. */
export type ReturnedValueAnalyzer = (
  scope: ResponseScope,
  deriver: TypeDeriver,
  returned: Node,
) => ResponseItem[];

/** The analyzer of each kind of returned value, by its token; `default` reads a value whose token none names. */
export interface ReturnedValueAnalyzers {
  readonly default: ReturnedValueAnalyzer;
  readonly [token: string]: ReturnedValueAnalyzer;
}

/** What a framework sends for an error a route throws. */
export interface ErrorResponder {
  responsesFor(site: ThrowSite, deriver: TypeDeriver): ResponseItem[];
}

export interface ResponseAnalyzerOptions {
  readonly returns: ReturnedValueAnalyzers;
  /** The readers of the members each error class the framework defines carries. */
  readonly errors: readonly ThrownErrorReader[];
  /** What the framework sends for a thrown error when the app registers no error handler. */
  readonly unhandled: ErrorResponder;
}

/**
 * How a framework sends a response: what each value a handler returns sends,
 * what each error it throws carries, and what the framework sends for an
 * error the app does not handle.
 */
export class ResponseAnalyzer {
  readonly errors: readonly ThrownErrorReader[];
  readonly unhandled: ErrorResponder;
  readonly #returns: ReturnedValueAnalyzers;

  constructor({ returns, errors, unhandled }: ResponseAnalyzerOptions) {
    this.#returns = returns;
    this.errors = errors;
    this.unhandled = unhandled;
  }

  /** What `returned`, a value the scope's handler returns with `token`, sends. */
  returned(
    scope: ResponseScope,
    deriver: TypeDeriver,
    token: string,
    returned: Node,
  ): ResponseItem[] {
    // A token such as `toString` is no analyzer the prototype holds.
    const analyzer = Object.hasOwn(this.#returns, token)
      ? this.#returns[token]
      : this.#returns.default;
    return analyzer(scope, deriver, returned);
  }
}
