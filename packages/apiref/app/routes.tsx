/* eslint-disable @nx/enforce-module-boundaries */
import { type RouteConfig, index, route } from '@react-router/dev/routes';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { type NavItem, loadSpec, toIR } from '@sdk-it/spec';

const spec = await toIR({
  spec: await loadSpec(
    process.env.VITE_SPEC || 'https://api.openstatus.dev/v1/openapi',
  ),
});

const template = await readFile(
  join(import.meta.dirname, '_template.txt'),
  'utf-8',
);

type DocPage = NavItem & { url: string; content: string };

const docs = spec['x-docs']
  .flatMap((it) => it.items)
  .filter((it): it is DocPage => Boolean(it.url && it.content));

const generatedDir = join(import.meta.dirname, '_generated');
await rm(generatedDir, { recursive: true, force: true });
await writeFiles(
  generatedDir,
  Object.fromEntries(
    docs.map((doc) => [
      `${doc.id}.tsx`,
      template.replace(
        '###PLACE_HERE###',
        `<MD content={${JSON.stringify(doc.content)}} />`,
      ),
    ]),
  ),
);

const overview = docs.find((doc) => doc.url === '/');
const pages = docs.filter((doc) => doc !== overview);

export default [
  overview
    ? index(`./_generated/${overview.id}.tsx`, { id: overview.id })
    : index('./app.tsx', { id: 'app-root' }),
  route('embed', './embed.tsx', { id: 'embed' }),
  route('/:group/:operationId', './app.tsx', { id: 'operation' }),
  ...pages.map((doc) =>
    route(doc.url.replace(/^\//, ''), `./_generated/${doc.id}.tsx`, {
      id: doc.id,
    }),
  ),
  route('*', './app.tsx', { id: 'catch-all' }),
] satisfies RouteConfig;
