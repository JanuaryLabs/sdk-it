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

test('UIMessage from ai becomes one shared model that compiles in the generated client', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-recursive-alias-')),
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
    );

    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths, components } = await analyze(project, { responseAnalyzer });
    const document = JSON.stringify({ paths, components });
    assert.doesNotMatch(document, /"type":"undefined"/);
    const { paths: documented } = JSON.parse(document) as {
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
    for (const path of ['/first', '/second']) {
      assert.deepStrictEqual(
        documented[path].get.responses[200].content['application/json'].schema
          .properties.messages.items,
        { $ref: '#/components/schemas/UIMessage' },
      );
    }
    const output = join(dir, 'client');
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
      `import type { Endpoints } from './index.ts';
import type { UiMessage } from './models/index.ts';
declare const first: Endpoints['GET /first']['output'];
declare const second: Endpoints['GET /second']['output'];
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
