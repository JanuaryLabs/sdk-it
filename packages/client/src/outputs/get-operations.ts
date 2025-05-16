import z from 'zod';

import type * as http from '../http/index.ts';
import { type ValidationError } from '../models/ValidationError.ts';
import { Pagination } from '../pagination.ts';

/**
 * Response for 200
 */
export type GetOperationsOutput200 = {
  operations: string[];
  pagination: { hasNextPage: boolean; hasPreviousPage: boolean };
  [http.KIND]: typeof http.Ok.kind;
};

/**
 * Bad Request
 */
export type GetOperationsOutput400 = ValidationError | undefined;
