import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('intersection response members and extended body fields stay required in the generated client', async () => {
  await using workspace = await analysisWorkspace('all-of-required-', {
    'schemas.ts': `import { z } from 'zod';

export const discoveredAccountSchema = z.object({
  detail: z.string(),
  displayName: z.string(),
  externalId: z.string(),
});
`,
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import * as schemas from './schemas.ts';

export interface DiscoveredAccount {
  detail: string;
  displayName: string;
  externalId: string;
}

declare function discover(): Promise<Array<DiscoveredAccount & { dataSourceId: string }>>;

export const app = new Hono();

/**
 * @openapi discoverAccounts
 * @tags sources
 */
app.get('/sources/:sourceId/accounts', validate((payload) => ({
  sourceId: { select: payload.params.sourceId, against: z.string() },
})), async (c) => {
  const found = await discover();
  return c.json({ found });
});

/**
 * @openapi addAccount
 * @tags sources
 */
app.post('/sources/:sourceId/accounts', validate('application/json', (payload) => ({
  sourceId: { select: payload.params.sourceId, against: z.string() },
  account: {
    select: payload.body.account,
    against: schemas.discoveredAccountSchema.extend({ dataSourceId: z.string() }),
  },
})), (c) => {
  return c.json({ externalId: c.var.input.account.externalId });
});

/**
 * @openapi linkAccount
 * @tags sources
 */
app.post('/sources/:sourceId/links', validate('application/json', (payload) => ({
  sourceId: { select: payload.params.sourceId, against: z.string() },
  account: {
    select: payload.body.account,
    against: z.intersection(
      schemas.discoveredAccountSchema,
      z.object({ dataSourceId: z.string() }),
    ),
  },
})), (c) => {
  return c.json({ externalId: c.var.input.account.externalId });
});
`,
  });

  using project = openAnalysisProject(workspace.tsconfig);
  const { paths, components } = await analyze(project, {
    responseAnalyzer,
    imports: [{ import: 'schemas', from: join(workspace.path, 'schemas.ts') }],
  });
  const output = join(workspace.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Sources', version: '1.0.0' },
      paths,
      components,
    },
    { output, name: 'Sources', readme: false, mode: 'full' },
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));
  const consumerPath = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumerPath,
    `import type { SourcesEndpoints } from './index.ts';
declare const discovered: SourcesEndpoints['GET /sources/{sourceId}/accounts']['output'];
const detail: string = discovered.found[0].detail;
const displayName: string = discovered.found[0].displayName;
const dataSourceId: string = discovered.found[0].dataSourceId;
// @ts-expect-error detail is a string, so found is not any[].
const notNumber: number = discovered.found[0].detail;
type AddAccount = SourcesEndpoints['POST /sources/{sourceId}/accounts']['input'];
const full: AddAccount = {
  sourceId: 's1',
  account: { detail: 'd', displayName: 'n', externalId: 'e', dataSourceId: 'ds' },
};
const missingDetail: AddAccount = {
  sourceId: 's1',
  // @ts-expect-error detail is required by the extended schema.
  account: { displayName: 'n', externalId: 'e', dataSourceId: 'ds' },
};
type LinkAccount = SourcesEndpoints['POST /sources/{sourceId}/links']['input'];
const fullLink: LinkAccount = {
  sourceId: 's1',
  account: { detail: 'd', displayName: 'n', externalId: 'e', dataSourceId: 'ds' },
};
const missingLinkDetail: LinkAccount = {
  sourceId: 's1',
  // @ts-expect-error detail is required by the intersected schema.
  account: { displayName: 'n', externalId: 'e', dataSourceId: 'ds' },
};
void [detail, displayName, dataSourceId, notNumber, full, missingDetail, fullLink, missingLinkDetail];
`,
  );
  const { files, diagnostics } = typecheck(configPath);
  assert.ok(files.includes(consumerPath));
  assert.deepEqual(diagnostics, []);
});
