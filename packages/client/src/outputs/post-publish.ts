import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type PostPublishOutput = {
  message: 'SDK published successfully';
  specUrl: string;
};

/**
 * Bad Request
 */
export type PostPublishOutput400 = ValidationError | undefined;
