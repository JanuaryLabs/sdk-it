import type { OperationEntry } from '@sdk-it/spec';

export type Snippet = {
  language: string;
  code: string;
};

export type AugmentedOperation = OperationEntry & {
  snippets: Snippet[];
};
