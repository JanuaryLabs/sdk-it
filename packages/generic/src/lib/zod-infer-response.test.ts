import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('a response typed through z.infer documents the inferred shape, and the client types it the same way', async () => {
  await using workspace = await analysisWorkspace('zod-infer-response-', {
    'usage.ts': `import z from 'zod';

const tokenCount = z.number().optional();
const model = z.string();
const chatUsageSchema = z.object({
  inputTokens: tokenCount,
  inputTokenDetails: z.object({
    noCacheTokens: tokenCount,
    cacheReadTokens: tokenCount,
  }),
  totalTokens: tokenCount,
  model,
});
export type ChatUsage = z.infer<typeof chatUsageSchema>;

const executeResultSchema = z.object({
  sql: z.string(),
  columns: z.array(z.string()),
  rowCount: z.number(),
});
export type ExecuteResult = z.infer<typeof executeResultSchema>;

export function readChatUsage(metadata: Record<string, unknown> | undefined): ChatUsage | null {
  const parsed = chatUsageSchema.safeParse(metadata?.usage);
  return parsed.success ? parsed.data : null;
}

export function execute(): ExecuteResult[] {
  return [];
}
`,
    'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import { execute, readChatUsage } from './usage.ts';

export const app = new Hono();

/** @openapi listMessages */
app.get('/messages', validate(() => ({})), (c) => {
  const usage = readChatUsage(undefined);
  const results = execute();
  return c.json({ messages: [], usage, results });
});
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  const body: any =
    spec.paths['/messages']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema;
  const output = join(workspace.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Chats', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    {
      output,
      name: 'Chats',
      packageName: '@acme/chats',
      readme: false,
      mode: 'full',
    },
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));
  const consumerPath = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumerPath,
    `import { createChats } from './index.ts';
const client = createChats({ baseUrl: 'https://example.test' });
const { usage, results } = await client.request('GET /messages', {});
const inputTokens: number | undefined = usage?.inputTokens;
const noCacheTokens: number | undefined = usage?.inputTokenDetails.noCacheTokens;
const model: string | undefined = usage?.model;
const columns: string[] | undefined = results[0]?.columns;
// @ts-expect-error inputTokens is a number, never a string.
const wrong: string | undefined = usage?.inputTokens;
// @ts-expect-error usage is null when the message has no usage.
const unchecked: string = usage.model;
// @ts-expect-error inputTokens is optional.
const required: number = usage!.inputTokens;
void [inputTokens, noCacheTokens, model, columns, wrong, unchecked, required];
`,
  );

  const { files, diagnostics } = typecheck(configPath);

  assert.deepStrictEqual(Object.keys(spec.components.schemas ?? {}).sort(), [
    'validate400_application_json',
    'validate415_application_json',
  ]);
  assert.deepStrictEqual(body.properties.usage, {
    anyOf: [
      { type: 'null' },
      {
        type: 'object',
        properties: {
          inputTokenDetails: {
            type: 'object',
            properties: {
              cacheReadTokens: { type: 'number' },
              noCacheTokens: { type: 'number' },
            },
            required: [],
            additionalProperties: false,
          },
          inputTokens: { type: 'number' },
          model: { type: 'string' },
          totalTokens: { type: 'number' },
        },
        required: ['inputTokenDetails', 'model'],
        additionalProperties: false,
      },
    ],
  });
  assert.deepStrictEqual(body.properties.results, {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        columns: { type: 'array', items: { type: 'string' } },
        rowCount: { type: 'number' },
        sql: { type: 'string' },
      },
      required: ['columns', 'rowCount', 'sql'],
      additionalProperties: false,
    },
  });
  assert.ok(files.includes(consumerPath));
  assert.deepStrictEqual(diagnostics, []);
});
