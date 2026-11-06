import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject, ParameterObject } from 'openapi3-ts/oas31';

import { parseErrorFor, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const variants = [
  {
    variant: 'beside a path parameter',
    path: '/chat/{chatId}/transcription',
    endpoint: 'POST /chat/{chatId}/transcription',
    params: { chatId: 'c1' },
    parameters: [
      {
        name: 'chatId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ] satisfies ParameterObject[],
  },
  {
    variant: 'without a path parameter',
    path: '/transcription',
    endpoint: 'POST /transcription',
    params: {},
    parameters: [] satisfies ParameterObject[],
  },
] as const;

const transcriptionSpec = (
  path: string,
  parameters: ParameterObject[],
): OpenAPIObject => ({
  openapi: '3.1.0',
  info: { title: 'Transcribe', version: '1.0.0' },
  paths: {
    [path]: {
      post: {
        operationId: 'transcribe',
        tags: ['chat'],
        parameters,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
                required: ['file'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
});

void test.each(variants, ({ variant, path, endpoint, params, parameters }) =>
  test(`a required multipart binary field ${variant} is required in the input type`, async () => {
    await using workspace = await workspaceDirectory(
      'required-multipart-types-',
    );
    await generate(transcriptionSpec(path, [...parameters]), {
      output: workspace.path,
      name: 'Transcribe',
      readme: false,
      mode: 'full',
    });
    const paramFields = JSON.stringify(params).slice(1, -1);
    await writeFile(
      join(workspace.path, 'src/consumer.ts'),
      `
import { createTranscribe } from './index.ts';
const client = createTranscribe({ baseUrl: 'https://example.test' });
void client.request('${endpoint}', { ${paramFields}${paramFields ? ', ' : ''}file: new Blob(['audio']) });
// @ts-expect-error file is required by the multipart body.
void client.request('${endpoint}', { ${paramFields} });
`,
    );
    const config = JSON.parse(
      await readFile(join(workspace.path, 'tsconfig.json'), 'utf8'),
    );
    config.compilerOptions.strict = true;

    const { files, diagnostics } = typecheck({
      tsconfig: config,
      directory: workspace.path,
    });

    assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
    assert.deepEqual(diagnostics, []);
  }),
);

void test.each(variants, ({ variant, path, endpoint, params, parameters }) =>
  test(`the generated client rejects a multipart body missing its required binary field ${variant} before fetch`, async () => {
    await using workspace = await workspaceDirectory(
      'required-multipart-runtime-',
    );
    try {
      await generate(transcriptionSpec(path, [...parameters]), {
        output: workspace.path,
        name: 'Transcribe',
        readme: false,
        mode: 'full',
      });
      const bundle = join(workspace.path, 'client.mjs');
      await build({
        entryPoints: [join(workspace.path, 'src/index.ts')],
        outfile: bundle,
        bundle: true,
        format: 'esm',
        platform: 'node',
        logLevel: 'silent',
      });
      const { createTranscribe } = await import(pathToFileURL(bundle).href);
      const requests: Request[] = [];
      const client = createTranscribe({
        baseUrl: 'https://api.example.com',
        fetch: async (request: Request) => {
          requests.push(request);
          return Response.json({});
        },
      });

      await assert.rejects(
        client.request(endpoint, { ...params }),
        parseErrorFor('file'),
      );
      assert.equal(requests.length, 0);

      await client.request(endpoint, {
        ...params,
        file: new Blob(['audio']),
      });
      const form = await requests[0].formData();
      const file = form.get('file');
      assert.ok(file instanceof Blob);
      assert.equal(await file.text(), 'audio');
    } finally {
      await stop();
    }
  }),
);
