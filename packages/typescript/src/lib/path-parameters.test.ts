import { test } from '@zukhruf/testing/node';
import { build, stop } from 'esbuild';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { workspaceDirectory } from '@sdk-it/testing';
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
      await using directory = await workspaceDirectory('path-parameters-');
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
          { output: directory.path, name: 'Files', readme: false },
        );
        const bundle = join(directory.path, 'client.mjs');
        await build({
          entryPoints: [join(directory.path, 'client.ts')],
          outfile: bundle,
          bundle: true,
          format: 'esm',
          platform: 'node',
          logLevel: 'silent',
        });
        const { createFiles } = await import(pathToFileURL(bundle).href);
        const requests: Request[] = [];
        const client = createFiles({
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
        await stop();
      }
    }),
);
