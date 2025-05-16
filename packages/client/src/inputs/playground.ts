import { z } from 'zod';

export const postPlaygroundSchema = z.object({ specFile: z.instanceof(Blob) });
