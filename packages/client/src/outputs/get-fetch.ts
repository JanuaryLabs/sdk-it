import z from 'zod';

import type * as http from '../http/index.ts';
import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type GetFetchOutput200 = any;

/**
 * Bad Request
 */
export type GetFetchOutput400 = ValidationError | undefined;
