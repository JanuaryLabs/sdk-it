import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const route = `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

export const ShareVisibility = {
  public: 'public',
  team: 'team',
} as const;
export type ShareVisibility =
  (typeof ShareVisibility)[keyof typeof ShareVisibility];

interface ChatShare {
  id: string;
  visibility: ShareVisibility;
}

interface PlainShare {
  id: string;
  visibility: 'public' | 'team';
}

export const app = new Hono();

function findShare(): ChatShare {
  return { id: 's1', visibility: ShareVisibility.team };
}

function listShares(): ChatShare[] {
  return [findShare()];
}

function findPlainShare(): PlainShare {
  return { id: 's1', visibility: 'team' };
}

/** @openapi getShare */
app.get('/share', validate(() => ({})), (c) => {
  return c.json(findShare());
});

/** @openapi listShares */
app.get('/shares', validate(() => ({})), (c) => {
  return c.json(listShares());
});

/** @openapi getPlainShare */
app.get('/plain-share', validate(() => ({})), (c) => {
  return c.json(findPlainShare());
});
`;

function workspace() {
  return analysisWorkspace('literal-enums-', { 'route.ts': route });
}

describe('a Prisma-style const-object enum field', () => {
  test('generated client types visibility as the public | team union', async () => {
    await using dir = await workspace();
    using project = openAnalysisProject(dir.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const output = join(dir.path, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Shares', version: '1.0.0' },
        paths: spec.paths,
        components: spec.components,
      },
      { output, name: 'Shares', readme: false, mode: 'full' },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { createShares } from './index.ts';
const client = createShares({ baseUrl: 'https://example.test' });
const share = await client.request('GET /share', {});
const v: 'public' | 'team' = share.visibility;
// @ts-expect-error 'other' is not a ShareVisibility.
const isOther = share.visibility === 'other';
const shares = await client.request('GET /shares', {});
const first: 'public' | 'team' | undefined = shares[0]?.visibility;
// @ts-expect-error visibility is a union of strings, so shares is not any[].
const firstNumber: number | undefined = shares[0]?.visibility;
const plain = await client.request('GET /plain-share', {});
const plainVisibility: 'public' | 'team' = plain.visibility;
// @ts-expect-error 'other' is not 'public' | 'team'.
const plainOther = plain.visibility === 'other';
void [v, isOther, first, firstNumber, plainVisibility, plainOther];
`,
    );

    const { files, diagnostics } = typecheck(configPath);

    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });
});
