import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '@sdk-it/typescript';

void test.each(
  [
    {
      id: 'folder/report',
      expectedUrl: 'https://api.example.com/files/folder%2Freport',
    },
    {
      id: 'report?download=true',
      expectedUrl: 'https://api.example.com/files/report%3Fdownload%3Dtrue',
    },
    {
      id: 'report#2026',
      expectedUrl: 'https://api.example.com/files/report%232026',
    },
    {
      id: 'report-2026',
      expectedUrl: 'https://api.example.com/files/report-2026',
    },
    {
      id: 'report%2F2026',
      expectedUrl: 'https://api.example.com/files/report%252F2026',
    },
  ],
  ({ id, expectedUrl }) =>
    test(`generated client preserves path parameter ${JSON.stringify(id)}`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sdk-it-path-parameters-'));
      try {
        await generate(
          {
            openapi: '3.1.0',
            info: { title: 'Files', version: '1.0.0' },
            paths: {
              '/files/{id}': {
                get: {
                  operationId: 'getFile',
                  tags: ['files'],
                  parameters: [
                    {
                      name: 'id',
                      in: 'path',
                      required: true,
                      schema: { type: 'string' },
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      content: {
                        'application/json': {
                          schema: { type: 'object' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          { output: dir, name: 'Files', readme: false },
        );
        const bundle = join(dir, 'client.mjs');
        await build({
          entryPoints: [join(dir, 'client.ts')],
          outfile: bundle,
          bundle: true,
          format: 'esm',
          platform: 'node',
          target: 'node24',
          nodePaths: [
            fileURLToPath(new URL('../../../../node_modules', import.meta.url)),
          ],
          logLevel: 'silent',
        });
        const { Files } = await import(pathToFileURL(bundle).href);
        const requests: Request[] = [];
        const client = new Files({
          baseUrl: 'https://api.example.com',
          fetch: async (request: Request) => {
            requests.push(request);
            return Response.json({ ok: true });
          },
        });

        await client.request('GET /files/{id}', { id });

        assert.deepEqual(
          requests.map((request) => request.url),
          [expectedUrl],
        );
      } finally {
        stop();
        await rm(dir, { recursive: true, force: true });
      }
    }),
);
