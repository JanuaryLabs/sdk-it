import { z } from 'zod';

export const getFetchSchema = z.object({ url: z.string().url() });
