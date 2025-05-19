import z from 'zod';

import type * as http from '../http/index.ts';
import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Response for 200
 */
export type PostPlaygroundOutput200 = {
  url: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml';
  title: string;
  name: string;
  clientName: string;
  [http.KIND]: typeof http.Ok.kind;
};

/**
 * Bad Request
 */
export type PostPlaygroundOutput400 = ValidationError | undefined;
