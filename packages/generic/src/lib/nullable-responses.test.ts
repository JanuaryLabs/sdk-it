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

interface AuthSession {
  userId: string;
}

interface Message {
  id: string;
  replyToMessageId: string | null;
  replyToExcerpt: string | null;
}

export const app = new Hono();

function findSession(): AuthSession | null {
  return null;
}

function findMessage(): Message {
  return { id: 'm1', replyToMessageId: null, replyToExcerpt: null };
}

/** @openapi getSession */
app.get('/session', validate(() => ({})), (c) => {
  const session = findSession();
  return c.json(session);
});

/** @openapi getMessage */
app.get('/message', validate(() => ({})), (c) => {
  return c.json(findMessage());
});
`;

const strictness = {
  'strict: true': { strict: true },
  'no strict flags': {},
} as const;

function workspace(compilerOptions: Record<string, unknown>) {
  return analysisWorkspace(
    'nullable-responses-',
    { 'route.ts': route },
    compilerOptions,
  );
}

function resolve(schema: any, schemas: Record<string, any>) {
  return schema.$ref ? schemas[schema.$ref.split('/').at(-1)] : schema;
}

function branches(schema: any): any[] {
  if (Array.isArray(schema.anyOf)) return schema.anyOf;
  if (Array.isArray(schema.oneOf)) return schema.oneOf;
  if (Array.isArray(schema.type)) {
    return schema.type.map((type: string) => ({ ...schema, type }));
  }
  return [schema];
}

describe('nullable response types keep null', () => {
  for (const [label, compilerOptions] of Object.entries(strictness)) {
    test(`a handler returning AuthSession | null documents a nullable body (${label})`, async () => {
      await using dir = await workspace(compilerOptions);
      using project = openAnalysisProject(dir.tsconfig);
      const { paths, components } = JSON.parse(
        JSON.stringify(await analyze(project, { responseAnalyzer })),
      );

      const schema =
        paths['/session'].get.responses['200'].content['application/json']
          .schema;
      const parts = branches(schema);
      assert.ok(
        parts.some((part) => part.type === 'null'),
        `no null branch in ${JSON.stringify(schema)}`,
      );
      const session = parts.find((part) => part.type !== 'null');
      assert.deepStrictEqual(resolve(session, components.schemas), {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
        additionalProperties: false,
      });
    });

    test(`string | null fields stay required and nullable (${label})`, async () => {
      await using dir = await workspace(compilerOptions);
      using project = openAnalysisProject(dir.tsconfig);
      const { paths, components } = JSON.parse(
        JSON.stringify(await analyze(project, { responseAnalyzer })),
      );

      const message = resolve(
        paths['/message'].get.responses['200'].content['application/json']
          .schema,
        components.schemas,
      );
      assert.deepStrictEqual(message.required, [
        'id',
        'replyToExcerpt',
        'replyToMessageId',
      ]);
      for (const field of ['replyToMessageId', 'replyToExcerpt']) {
        assert.deepStrictEqual(
          branches(message.properties[field])
            .map((part) => part.type)
            .sort(),
          ['null', 'string'],
          `${field}: ${JSON.stringify(message.properties[field])}`,
        );
      }
    });
  }

  test('generated client forces a null check on the session and types nullable fields as string | null', async () => {
    await using dir = await workspace({ strict: true });
    using project = openAnalysisProject(dir.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const output = join(dir.path, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Chat', version: '1.0.0' },
        paths: spec.paths,
        components: spec.components,
      },
      { output, name: 'Chat', readme: false, mode: 'full' },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { Chat } from './index.ts';
const client = new Chat({ baseUrl: 'https://example.test' });
const session = await client.request('GET /session', {});
// @ts-expect-error session is null when nobody is signed in.
const unchecked: string = session.userId;
const checked: string | undefined = session === null ? undefined : session.userId;
const msg = await client.request('GET /message', {});
const r: string | null = msg.replyToMessageId;
const e: string | null = msg.replyToExcerpt;
// @ts-expect-error replyToMessageId can be null.
const notNull: string = msg.replyToMessageId;
void [unchecked, checked, r, e, notNull];
`,
    );

    const { files, diagnostics } = typecheck(configPath);

    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });
});
