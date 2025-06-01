import { type ValidationError } from '../models/ValidationError.ts';

/**
 * OK
 */
export type PostAugmentOutput = unknown;

/**
 * Bad Request
 */
export type PostAugmentOutput400 = ValidationError;
