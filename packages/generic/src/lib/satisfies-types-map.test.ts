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
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

test('typesMap applies to UIMessage[] written with satisfies and with an annotation', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-satisfies-types-map-')),
  );
  try {
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
    await writeFile(
      join(dir, 'route.ts'),
      `import { Hono } from 'hono';
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
    );

    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths, components } = await analyze(project, {
      responseAnalyzer,
      typesMap: { UIMessage: '#/components/schemas/JsonObject' },
    });
    const { paths: documented } = JSON.parse(JSON.stringify({ paths })) as {
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
    };
    for (const path of ['/satisfied', '/annotated']) {
      assert.deepStrictEqual(
        documented[path].get.responses[200].content['application/json'].schema
          .properties.messages.items,
        { $ref: '#/components/schemas/JsonObject' },
      );
    }
    const output = join(dir, 'client');
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
      `import type { Endpoints } from './index.ts';
import type { JsonObject } from './models/index.ts';
declare const satisfied: Endpoints['GET /satisfied']['output'];
declare const annotated: Endpoints['GET /annotated']['output'];
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
