import type { ConvertedSchema } from './zod-to-json-schema.js';

/** A binding an `against` reads, besides `z`, with its module resolved. */
export interface Binding {
  /** The name the `against` reads. */
  import: string;
  /** The module's URL, as `ZodEvaluator.resolve` returns it. */
  from: string;
  /** The export the name binds; without it, the name is the module namespace. */
  property?: string;
}

export type EvaluationRequest =
  | { id: number; kind: 'resolve'; specifier: string; referrer: string }
  | { id: number; kind: 'load'; imports: readonly Binding[] }
  | {
      id: number;
      kind: 'evaluate';
      against: string;
      imports: readonly Binding[];
    };

export type EvaluationReply =
  | { id: number; kind: 'resolved'; url: string }
  | { id: number; kind: 'loaded' }
  | { id: number; kind: 'evaluated'; result: ConvertedSchema }
  | { id: number; kind: 'failed'; error: unknown };
