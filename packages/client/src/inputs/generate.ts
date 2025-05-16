import { z } from 'zod';

export const postGenerateSchema = z.object({ specFile: z.instanceof(Blob) });
