import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type GetOperationsOutput = {
  operations: string[];
  pagination: { hasNextPage: boolean; hasPreviousPage: boolean };
};

/**
 * Bad Request
 */
export type GetOperationsOutput400 = ValidationError | undefined;
