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
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi transcribe */
app.post('/chat/:chatId/transcription', validate('multipart/form-data', (payload) => ({
  chatId: { select: payload.params.chatId, against: z.string() },
  file: { select: payload.body.file, against: z.instanceof(Blob) },
})), (c) => {
  return c.json({ text: '' });
});
`;

async function workspace() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-required-multipart-blob-')),
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

describe('a required multipart Blob beside a path param', () => {
  test('stays in the multipart body schema required list', async () => {
    const dir = await workspace();
    try {
      using project = openAnalysisProject(join(dir, 'tsconfig.json'));
      const { paths } = JSON.parse(
        JSON.stringify(await analyze(project, { responseAnalyzer })),
      );

      const operation = paths['/chat/{chatId}/transcription'].post;
      assert.deepStrictEqual(
        operation.requestBody.content['multipart/form-data'].schema.required,
        ['file'],
      );
      assert.deepStrictEqual(
        operation.parameters.map(
          (p: { in: string; name: string; required: boolean }) => [
            p.in,
            p.name,
            p.required,
          ],
        ),
        [['path', 'chatId', true]],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('generated client types file as required', async () => {
    const dir = await workspace();
    try {
      using project = openAnalysisProject(join(dir, 'tsconfig.json'));
      const spec = await analyze(project, { responseAnalyzer });
      const output = join(dir, 'client');
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
await client.request('POST /chat/{chatId}/transcription', {
  chatId: 'c1',
  file: new Blob([]),
});
// @ts-expect-error file is required.
await client.request('POST /chat/{chatId}/transcription', { chatId: 'c1' });
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
