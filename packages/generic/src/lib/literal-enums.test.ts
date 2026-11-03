import assert from 'node:assert/strict';
import {
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

async function workspace() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-literal-enums-')),
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
        strict: true,
        skipLibCheck: true,
      },
      include: ['route.ts'],
    }),
  );
  await writeFile(join(dir, 'route.ts'), route);
  return dir;
}

describe('a Prisma-style const-object enum field', () => {
  test('generated client types visibility as the public | team union', async () => {
    const dir = await workspace();
    try {
      using project = openAnalysisProject(join(dir, 'tsconfig.json'));
      const spec = await analyze(project, { responseAnalyzer });
      const output = join(dir, 'client');
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
        `import { Shares } from './index.ts';
const client = new Shares({ baseUrl: 'https://example.test' });
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
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
