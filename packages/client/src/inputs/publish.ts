import { z } from 'zod';

export const postPublishSchema = z.object({ specUrl: z.string().url() });
