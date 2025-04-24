import type { OperationEntry } from '@sdk-it/spec/operation.js';

export type AugmentedOperation = OperationEntry & { snippets: { language: string; code: string }[] }