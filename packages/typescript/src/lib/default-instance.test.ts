import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

function notesSpec(servers: string[]): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Notes', version: '1.0.0' },
    servers: servers.map((url) => ({ url })),
    tags: [{ name: 'notes' }],
    paths: {
      '/notes': {
        get: {
          operationId: 'listNotes',
          tags: ['notes'],
          responses: { '204': { description: 'No Content' } },
        },
      },
    },
  };
}

/** Type-checks `consumer` as src/consumer.ts of the SDK generated into `directory`. */
async function checkConsumer(directory: string, consumer: string) {
  await writeFile(join(directory, 'src/consumer.ts'), consumer);
  const { files, diagnostics } = typecheck(join(directory, 'tsconfig.json'));
  assert.ok(files.some((file) => file.endsWith('src/consumer.ts')));
  return diagnostics;
}

void test('an SDK whose spec names one server exports a default instance that builds requests to it without settings', async () => {
  await using workspace = await workspaceDirectory('default-instance-one-');
  await generate(notesSpec(['https://api.test/v1']), {
    output: workspace.path,
    name: 'Notes',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
  });
  const { notes } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );

  const { url } = await notes.prepare('GET /notes', {});

  assert.equal(url.href, 'https://api.test/v1/notes');
});

void test('an SDK whose spec names no server exports a default instance that sends to "/" (OpenAPI 3.2)', async () => {
  await using workspace = await workspaceDirectory('default-instance-none-');
  await generate(notesSpec([]), {
    output: workspace.path,
    name: 'Notes',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
  });
  const { notes } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );

  await assert.rejects(notes.prepare('GET /notes', {}), {
    message:
      'baseUrl "/" is relative, and there is no page location to resolve it against.',
  });
});

void test('an SDK whose spec names two servers exports no default instance', async () => {
  await using workspace = await workspaceDirectory('default-instance-two-');
  await generate(notesSpec(['https://eu.api.test', 'https://us.api.test']), {
    output: workspace.path,
    name: 'Notes',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
  });

  const diagnostics = await checkConsumer(
    workspace.path,
    `import { createNotes } from './index.ts';
// @ts-expect-error two servers leave no default instance
import { notes } from './index.ts';
createNotes({ baseUrl: 'https://us.api.test' });
void notes;
`,
  );

  assert.deepEqual(diagnostics, []);
});

void test('an SDK named after its tag exports the default instance at the root and the agent group from agents.ts', async () => {
  await using workspace = await workspaceDirectory('default-instance-agents-');
  await generate(notesSpec(['https://api.test']), {
    output: workspace.path,
    name: 'Notes',
    packageName: '@acme/sdk',
    readme: false,
    mode: 'full',
    agentTools: 'ai-sdk',
  });

  const diagnostics = await checkConsumer(
    workspace.path,
    `import { notes as agent } from './agents.ts';
import { notes } from './index.ts';
export const prepared = notes.prepare('GET /notes', {});
export const tools: object = agent.tools;
`,
  );

  assert.deepEqual(diagnostics, []);
});
