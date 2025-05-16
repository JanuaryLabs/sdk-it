import z from 'zod';

import type * as http from '../http';
import { type ValidationError } from '../models/ValidationError.ts';

/**
 * Bad Request
 */
export type PostAnnotateOutput400 = ValidationError | undefined;
