import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('UIMessage from ai becomes one shared model that compiles in the generated client', async () => {
  await using dir = await analysisWorkspace('recursive-alias-', {
    'route.ts': `import { Hono } from 'hono';
import type { UIMessage } from 'ai';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();
const emptyMessages: UIMessage[] = [];

/**
 * @openapi firstMessages
 * @tags chats
 */
app.get('/first', validate(() => ({})), (c) => {
  return c.json({ messages: emptyMessages });
});

/**
 * @openapi secondMessages
 * @tags chats
 */
app.get('/second', validate(() => ({})), (c) => {
  return c.json({ messages: emptyMessages });
});
`,
  });

  using project = openAnalysisProject(dir.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  const document = JSON.stringify({ paths, components });
  assert.doesNotMatch(document, /"type":"undefined"/);
  const {
    paths: documented,
  }: {
    paths: Record<
      string,
      {
        get: {
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: { properties: { messages: { items: unknown } } };
                };
              };
            };
          };
        };
      }
    >;
  } = JSON.parse(document);
  for (const path of ['/first', '/second']) {
    assert.deepStrictEqual(
      documented[path].get.responses[200].content['application/json'].schema
        .properties.messages.items,
      { $ref: '#/components/schemas/UIMessage' },
    );
  }
  const output = join(dir.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Chats', version: '1.0.0' },
      paths,
      components,
    },
    { output, name: 'Chats', readme: false, mode: 'full' },
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));
  const consumerPath = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumerPath,
    `import type { ChatsEndpoints } from './index.ts';
import type { UiMessage } from './models/index.ts';
declare const first: ChatsEndpoints['GET /first']['output'];
declare const second: ChatsEndpoints['GET /second']['output'];
const firstMessages: UiMessage[] = first.messages;
const secondMessages: UiMessage[] = second.messages;
const parts = firstMessages[0].parts;
const role: 'user' | 'assistant' | 'system' = secondMessages[0].role;
// @ts-expect-error role is a closed union of message roles.
const badRole: 'tool' = secondMessages[0].role;
// @ts-expect-error The endpoint output is typed, so a message is not a number.
const notNumber: number = second.messages[0];
void [parts, role, badRole, notNumber];
`,
  );
  const { files, diagnostics } = typecheck(configPath);
  assert.ok(files.includes(consumerPath));
  assert.deepEqual(diagnostics, []);
});
