import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { logger as requestLogger } from 'hono/logger';
import { requestId } from 'hono/request-id';

import { talk } from './groq.js';

const app = new Hono().use(
  contextStorage(),
  requestLogger(),
  cors({ origin: '*' }),
  requestId(),
);

app.post('/', async (c) => {
  const { messages, id } = await c.req.json();
  const r = talk(id, messages);
  return r.toDataStreamResponse();
});

app.post(
  '/generate',
  // validate((payload) => ({
  //   file: {
  //     select: payload.body.file,
  //     against: z.instanceof(File),
  //   },
  // })),
  async (c) => {
    return;
  },
);

serve(app, (addressInfo) => {
  console.log(`Server is running on http://localhost:${addressInfo.port}`);
});
