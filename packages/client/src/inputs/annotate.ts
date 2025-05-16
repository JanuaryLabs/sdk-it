import { z } from 'zod';

export const postAnnotateSchema = z.object({ specUrl: z.string().url() });
