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

function workspace() {
  return analysisWorkspace('required-multipart-blob-', { 'route.ts': route });
}

describe('a required multipart Blob beside a path param', () => {
  test('stays in the multipart body schema required list', async () => {
    await using dir = await workspace();
    using project = openAnalysisProject(dir.tsconfig);
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
  });

  test('generated client types file as required', async () => {
    await using dir = await workspace();
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
      `import { createChat } from './index.ts';
const client = createChat({ baseUrl: 'https://example.test' });
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
  });
});
