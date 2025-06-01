import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type PostPlaygroundOutput = {
  url: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml';
  title: string;
  name: string;
  clientName: string;
};

/**
 * Bad Request
 */
export type PostPlaygroundOutput400 = ValidationError;
