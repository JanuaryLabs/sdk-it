import type { OperationEntry } from '@sdk-it/spec/operation.js';

export type Snippet = {
  language: string;
  code: string;
};

export type AugmentedOperation = OperationEntry & {
  snippets: Snippet[];
};
