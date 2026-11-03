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
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { parseErrorFor, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const routes = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/**
 * @openapi sendMessage
 * @tags chats
 */
app.post('/chat/:chatId/messages', validate('application/json', (payload) => ({
  chatId: { select: payload.params.chatId, against: z.string() },
  content: { select: payload.body.content, against: z.string() },
  id: { select: payload.body.id, against: z.string() },
  note: { select: payload.body.note, against: z.string().optional() },
})), (c) => {
  return c.json({ id: c.var.input.id });
});

/**
 * @openapi updateGroupTemplate
 * @tags groupTemplates
 */
app.put('/group-templates/:templateId', validate('application/json', (payload) => ({
  templateId: { select: payload.params.templateId, against: z.string() },
  agents: { select: payload.body.agents, against: z.array(z.string()) },
})), (c) => {
  return c.json({ agents: c.var.input.agents });
});
`;

test('required body fields beside path params stay required in the generated client', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-required-body-')),
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
    await writeFile(join(dir, 'route.ts'), routes);

    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths, components } = await analyze(project, { responseAnalyzer });
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
      `import { Chats } from './index.ts';
const client = new Chats({ baseUrl: 'https://example.test' });
await client.request('POST /chat/{chatId}/messages', {
  chatId: 'c1', content: 'hello', id: 'm1',
});
await client.request('POST /chat/{chatId}/messages', {
  chatId: 'c1', content: 'hello', id: 'm1', note: 'n',
});
// @ts-expect-error content is a required body field.
await client.request('POST /chat/{chatId}/messages', { chatId: 'c1', id: 'm1' });
await client.request('PUT /group-templates/{templateId}', {
  templateId: 't1', agents: ['a1'],
});
// @ts-expect-error agents is a required body field.
await client.request('PUT /group-templates/{templateId}', { templateId: 't1' });
`,
    );
    const { files, diagnostics } = typecheck(configPath);
    assert.ok(files.includes(consumerPath));
    assert.deepEqual(diagnostics, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generated client rejects a request missing a required body field before fetch', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-required-body-runtime-')),
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
    await writeFile(join(dir, 'route.ts'), routes);

    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths, components } = await analyze(project, { responseAnalyzer });
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
    const { Chats } = await import(
      pathToFileURL(join(output, 'src/index.ts')).href
    );
    const requests: Request[] = [];
    const client = new Chats({
      baseUrl: 'https://example.test',
      fetch: async (request: Request) => {
        requests.push(request);
        return Response.json({ id: 'm1' });
      },
    });

    await assert.rejects(
      client.request('POST /chat/{chatId}/messages', {
        chatId: 'c1',
        id: 'm1',
      }),
      parseErrorFor('content'),
    );
    await assert.rejects(
      client.request('PUT /group-templates/{templateId}', {
        templateId: 't1',
      }),
      parseErrorFor('agents'),
    );
    assert.deepEqual(requests, []);

    await client.request('POST /chat/{chatId}/messages', {
      chatId: 'c1',
      id: 'm1',
      content: 'hello',
    });
    assert.equal(requests.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
