import { z } from 'zod';

export const postAugmentSchema = z.object({ specUrl: z.string().url() });
