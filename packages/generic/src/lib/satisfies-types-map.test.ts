import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('typesMap applies to UIMessage[] written with satisfies and with an annotation', async () => {
  await using dir = await analysisWorkspace('satisfies-types-map-', {
    'route.ts': `import { Hono } from 'hono';
import type { UIMessage } from 'ai';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/**
 * @openapi listSatisfiedMessages
 * @tags chats
 */
app.get('/satisfied', validate(() => ({})), (c) => {
  return c.json({ messages: [] satisfies UIMessage[], usage: null });
});

const emptyMessages: UIMessage[] = [];

/**
 * @openapi listAnnotatedMessages
 * @tags chats
 */
app.get('/annotated', validate(() => ({})), (c) => {
  return c.json({ messages: emptyMessages, usage: null });
});
`,
  });

  using project = openAnalysisProject(dir.tsconfig);
  const { paths, components } = await analyze(project, {
    responseAnalyzer,
    typesMap: { UIMessage: '#/components/schemas/JsonObject' },
  });
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
  } = JSON.parse(JSON.stringify({ paths }));
  for (const path of ['/satisfied', '/annotated']) {
    assert.deepStrictEqual(
      documented[path].get.responses[200].content['application/json'].schema
        .properties.messages.items,
      { $ref: '#/components/schemas/JsonObject' },
    );
  }
  const output = join(dir.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Chats', version: '1.0.0' },
      paths,
      components: {
        ...components,
        schemas: {
          ...components.schemas,
          JsonObject: { type: 'object', additionalProperties: {} },
        },
      },
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
import type { JsonObject } from './models/index.ts';
declare const satisfied: ChatsEndpoints['GET /satisfied']['output'];
declare const annotated: ChatsEndpoints['GET /annotated']['output'];
const satisfiedMessages: JsonObject[] = satisfied.messages;
const annotatedMessages: JsonObject[] = annotated.messages;
const satisfiedRecords: Array<Record<string, unknown>> = satisfied.messages;
const annotatedRecords: Array<Record<string, unknown>> = annotated.messages;
// @ts-expect-error A message is an object, not a number.
const satisfiedBad: number = satisfied.messages[0];
// @ts-expect-error A message is an object, not a number.
const annotatedBad: number = annotated.messages[0];
void [satisfiedMessages, annotatedMessages, satisfiedRecords, annotatedRecords, satisfiedBad, annotatedBad];
`,
  );
  const { files, diagnostics } = typecheck(configPath);
  assert.ok(files.includes(consumerPath));
  assert.deepEqual(diagnostics, []);
});
