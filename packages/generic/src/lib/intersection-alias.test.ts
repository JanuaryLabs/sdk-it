import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const workspaceApp = `export interface WorkspaceApp {
  name: string;
  projectName: string;
  root: string;
  createdAt: string;
}
`;

const intersectionSummary = `export type AppSummary = WorkspaceApp & {
  activeJobId: string | null;
  status: string;
  url: string;
};`;

const extendsSummary = `export interface AppSummary extends WorkspaceApp {
  activeJobId: string | null;
  status: string;
  url: string;
}`;

function route(summary: string, imported: boolean) {
  return `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
${imported ? `import type { WorkspaceApp } from './workspace.ts';` : workspaceApp}
${summary}

export const app = new Hono();

function summarize(): AppSummary {
  return {
    name: 'web',
    projectName: 'acme',
    root: '/apps/web',
    createdAt: '2026-01-01T00:00:00.000Z',
    activeJobId: null,
    status: 'idle',
    url: 'https://web.test',
  };
}

/** @openapi getApp */
app.get('/apps/current', validate(() => ({})), (c) => {
  return c.json(summarize());
});
`;
}

function workspace(files: Record<string, string>) {
  return analysisWorkspace('intersection-alias-', files);
}

describe('an inherited response type returned as JSON', () => {
  for (const [kind, summary] of [
    ['intersection alias', intersectionSummary],
    ['extending interface', extendsSummary],
  ] as const) {
    for (const imported of [false, true]) {
      test(`generated client types every AppSummary field as required (${kind}, WorkspaceApp ${imported ? 'imported' : 'local'})`, async () => {
        await using dir = await workspace({
          'route.ts': route(summary, imported),
          ...(imported ? { 'workspace.ts': workspaceApp } : {}),
        });
        using project = openAnalysisProject(dir.tsconfig);
        const spec = await analyze(project, { responseAnalyzer });
        const output = join(dir.path, 'client');
        await generate(
          {
            openapi: '3.1.0',
            info: { title: 'Apps', version: '1.0.0' },
            paths: spec.paths,
            components: spec.components,
          },
          { output, name: 'Apps', readme: false, mode: 'full' },
        );
        const configPath = join(output, 'tsconfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        config.compilerOptions.strict = true;
        await writeFile(configPath, JSON.stringify(config));
        const consumerPath = join(output, 'src', 'consumer.ts');
        await writeFile(
          consumerPath,
          `import { createApps } from './index.ts';
const client = createApps({ baseUrl: 'https://example.test' });
const summary = await client.request('GET /apps/current', {});
const name: string = summary.name;
const projectName: string = summary.projectName;
const root: string = summary.root;
const createdAt: string = summary.createdAt;
const activeJobId: string | null = summary.activeJobId;
const status: string = summary.status;
const url: string = summary.url;
// @ts-expect-error name is a string, so summary is not any.
const notNumber: number = summary.name;
void [name, projectName, root, createdAt, activeJobId, status, url, notNumber];
`,
        );

        const { files, diagnostics } = typecheck(configPath);

        assert.ok(files.includes(consumerPath));
        assert.deepStrictEqual(diagnostics, []);
      });
    }
  }
});
