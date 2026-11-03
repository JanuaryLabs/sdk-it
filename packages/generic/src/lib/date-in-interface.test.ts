import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const variants: Record<string, Record<string, string>> = {
  'local interface': {
    'route.ts': `interface Ticket {
  id: string;
  createdAt: Date;
}`,
  },
  'interface imported from another module': {
    'route.ts': `import type { Ticket } from './models.ts';`,
    'models.ts': `export interface Ticket {
  id: string;
  createdAt: Date;
}
`,
  },
  'Prisma-style payload model imported from a generated client': {
    'route.ts': `import type { Ticket } from './generated/client.ts';`,
    'generated/client.ts': `export type $TicketPayload = {
  name: 'Ticket';
  objects: {};
  scalars: {
    id: string;
    createdAt: Date;
  };
};
export type DefaultSelection<P extends { scalars: object }> = P['scalars'];
export type Ticket = DefaultSelection<$TicketPayload>;
`,
  },
};

function route(head: string) {
  return `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
${head}

export const app = new Hono();

function load(): Ticket {
  return { id: 't1', createdAt: new Date(0) };
}

/** @openapi getTicket */
app.get('/tickets/current', validate(() => ({})), (c) => {
  return c.json(load());
});
`;
}

async function workspace(files: Record<string, string>) {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-date-in-interface-')),
  );
  const require = createRequire(import.meta.url);
  await symlink(
    dirname(dirname(require.resolve('zod/package.json'))),
    join(dir, 'node_modules'),
    'dir',
  );
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        strict: true,
        skipLibCheck: true,
      },
      include: Object.keys(files),
    }),
  );
  for (const [file, content] of Object.entries(files)) {
    const path = join(dir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return dir;
}

function filesOf(variant: Record<string, string>) {
  const { 'route.ts': head, ...rest } = variant;
  return { 'route.ts': route(head), ...rest };
}

describe('a Date field inside a named response type', () => {
  for (const [name, variant] of Object.entries(variants)) {
    test(`generated client types createdAt as string (${name})`, async () => {
      const dir = await workspace(filesOf(variant));
      try {
        using project = openAnalysisProject(join(dir, 'tsconfig.json'));
        const spec = await analyze(project, { responseAnalyzer });
        const output = join(dir, 'client');
        await generate(
          {
            openapi: '3.1.0',
            info: { title: 'Tickets', version: '1.0.0' },
            paths: spec.paths,
            components: spec.components,
          },
          { output, name: 'Tickets', readme: false, mode: 'full' },
        );
        const configPath = join(output, 'tsconfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        config.compilerOptions.strict = true;
        await writeFile(configPath, JSON.stringify(config));
        const consumerPath = join(output, 'src', 'consumer.ts');
        await writeFile(
          consumerPath,
          `import { Tickets } from './index.ts';
const client = new Tickets({ baseUrl: 'https://example.test' });
const ticket = await client.request('GET /tickets/current', {});
const id: string = ticket.id;
const at: string = ticket.createdAt;
// @ts-expect-error createdAt is a string on the wire, not a Date.
ticket.createdAt.getTime();
void [id, at];
`,
        );

        const { files, diagnostics } = typecheck(configPath);

        assert.ok(files.includes(consumerPath));
        assert.deepStrictEqual(diagnostics, []);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});
