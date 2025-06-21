import type * as models from '../index.ts';

export type GetOperations = {
  operations: string[];
  pagination: { hasNextPage: boolean; hasPreviousPage: boolean };
};

export type GetOperations400 = models.ValidationError;
