import z from 'zod';

import type * as http from '../http/index.ts';
import { type ValidationError } from '../models/ValidationError.ts';

/**
 * OK
 */
export type PostAugmentOutput200 = unknown;

/**
 * Bad Request
 */
export type PostAugmentOutput400 = ValidationError | undefined;
