import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
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

function filesOf(variant: Record<string, string>) {
  const { 'route.ts': head, ...rest } = variant;
  return { 'route.ts': route(head), ...rest };
}

describe('a Date field inside a named response type', () => {
  for (const [name, variant] of Object.entries(variants)) {
    test(`generated client types createdAt as string (${name})`, async () => {
      await using workspace = await analysisWorkspace(
        'date-in-interface-',
        filesOf(variant),
      );
      using project = openAnalysisProject(workspace.tsconfig);
      const spec = await analyze(project, { responseAnalyzer });
      const output = join(workspace.path, 'client');
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
        `import { createTickets } from './index.ts';
const client = createTickets({ baseUrl: 'https://example.test' });
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
    });
  }
});
