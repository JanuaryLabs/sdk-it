import { TemporaryFiles } from '@zukhruf/testing/fs';
import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'vite';

import { writeFiles } from '@sdk-it/core/file-system.js';
import sdkIt from '@sdk-it/vite';

test('a build generates the SDK from a spec served over http', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'vite-remote-spec-',
  );
  const app = workspace.path;
  writeFileSync(join(app, 'main.js'), '');
  await using server = await new HttpServer().start((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Pets', version: '1.0.0' },
        paths: {
          '/pets': {
            get: {
              operationId: 'listPets',
              responses: { '200': { description: 'Pets' } },
            },
          },
        },
      }),
    );
  });
  const written: string[] = [];

  await build({
    configFile: false,
    root: app,
    logLevel: 'silent',
    build: {
      rollupOptions: { input: join(app, 'main.js') },
      write: false,
    },
    plugins: [
      sdkIt(`${server.origin}/openapi.json`, {
        name: 'Example',
        packageName: '@acme/example-client',
        output: join(app, 'sdk'),
        writer: async (dir, contents) => {
          written.push(...Object.values(contents).map(String));
          await writeFiles(dir, contents);
        },
        cleanup: false,
        readme: false,
      }),
    ],
  });

  assert.ok(written.some((content) => content.includes('listPets')));
});
