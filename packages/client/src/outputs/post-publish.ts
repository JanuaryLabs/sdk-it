import z from 'zod';

import type * as http from '../http/index.ts';
import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type PostPublishOutput200 = {
  message: 'SDK published successfully';
  specUrl: string;
  [http.KIND]: typeof http.Ok.kind;
};

/**
 * Bad Request
 */
export type PostPublishOutput400 = ValidationError | undefined;
