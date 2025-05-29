import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type PostGenerateOutput = ReadableStream;

/**
 * Bad Request
 */
export type PostGenerateOutput400 = ValidationError | undefined;
