import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as requestLogger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { join, relative } from 'node:path';
import { cwd } from 'node:process';
import { type ServerBuild, createRequestHandler } from 'react-router';

const app = new Hono().use(requestLogger(), cors({ origin: '*' }), requestId());

app.use(
  '/assets/*',
  serveStatic({
    root: relative(cwd(), join(import.meta.dirname, 'dist', 'client')),
  }),
);

const serverBuildUrl = new URL('./dist/server/index.js', import.meta.url).href;

app.use(async (c) => {
  const build: ServerBuild = await import(serverBuildUrl);
  return createRequestHandler(build)(c.req.raw);
});

serve({ fetch: app.fetch, port: 3002 }, (addressInfo) => {
  console.log(`Server is running on http://localhost:${addressInfo.port}`);
});
