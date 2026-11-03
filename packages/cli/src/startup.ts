import { z } from 'zod';

const env = z.object({
  NPM_TOKEN: z.string().optional(),
});

env.parse(process.env);
