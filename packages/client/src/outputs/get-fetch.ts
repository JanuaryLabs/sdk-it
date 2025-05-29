import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type GetFetchOutput = any;

/**
 * Bad Request
 */
export type GetFetchOutput400 = ValidationError | undefined;
