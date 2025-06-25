/* eslint-disable @nx/enforce-module-boundaries */
import { type RouteConfig, index, route } from '@react-router/dev/routes';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { augmentSpec, loadSpec } from '@sdk-it/spec';

const spec = augmentSpec({
  spec: await loadSpec(
    process.env.VITE_SPEC || 'https://api.openstatus.dev/v1/openapi',
  ),
});

const template = await readFile(
  join(import.meta.dirname, '_template.txt'),
  'utf-8',
);

const docs = spec['x-docs'] ?? [];
await writeFiles(
  join(import.meta.dirname, '_generated'),
  docs
    .flatMap((it) => it.items)
    .filter((it) => it.content)
    .reduce(
      (acc, curr) => ({
        ...acc,
        [`${curr.id}.tsx`]: template.replace(
          '###PLACE_HERE###',
          `<MD id={'${curr.id}'} content={${JSON.stringify(curr.content)}} />`,
        ),
      }),
      {},
    ),
);

export default [
  index('./app.tsx', { id: 'app-root' }), // exact "/"
  route('embed', './embed.tsx', { id: 'embed' }), // /embed
  route('/:group/:operationId', './app.tsx', {
    id: 'operation',
  }),
  ...docs
    .flatMap((it) => it.items)
    .filter((it) => it.content)
    .map((doc) =>
      route(doc.id, `./_generated/${doc.id}.tsx`, {
        id: doc.id,
      }),
    ),
  route('*', './app.tsx', {
    id: 'catch-all',
  }), // catch all
] satisfies RouteConfig;
