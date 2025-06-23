import type * as models from '../index.ts';

export type GetOperations = {
  operations: string[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export type GetOperations400 = models.ValidationError;
