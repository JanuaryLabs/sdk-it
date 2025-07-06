import type {
  OperationEntry,
  TunedOperationObject,
} from '@sdk-it/spec/types.js';

export interface Generator {
  client(): string;
  snippet(entry: OperationEntry, operation: TunedOperationObject): string;
}
