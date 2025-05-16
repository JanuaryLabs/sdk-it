import z from 'zod';

import type * as http from '../http/index.ts';
import { type ValidationError } from '../models/ValidationError.ts';
import { Pagination } from '../pagination.ts';

/**
 * Response for 200
 */
export type PostGenerateOutput200 = ReadableStream;

/**
 * Bad Request
 */
export type PostGenerateOutput400 = ValidationError | undefined;
