import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { runNode, workspaceDirectory } from '@sdk-it/testing';

function intakeSpec(server: string): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Intake', version: '1.0.0' },
    servers: [{ url: server }],
    paths: {
      '/forms': {
        post: {
          operationId: 'submitForm',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { kind: { type: 'string', const: 'intake' } },
                  required: ['kind'],
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
  };
}

/** The API the CLI calls: it answers every request with `{"accepted":true}`. */
async function upstream() {
  const server = await new HttpServer().start((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accepted: true }));
  });
  return {
    url: server.origin,
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/** Runs `intake …args` for `spec` as a shell does, with an empty stdin. */
async function intake(
  directory: string,
  spec: OpenAPIObject,
  args: string[],
  options = '',
) {
  const specPath = join(directory, 'openapi.json');
  const cliPath = join(directory, 'intake.mjs');
  await writeFile(specPath, JSON.stringify(spec));
  await writeFile(
    cliPath,
    `import { command } from '@sdk-it/command';
const [spec, ...args] = process.argv.slice(2);
const program = await command(spec, { name: 'intake', ${options} });
await program.parseAsync(['node', 'intake', ...args]);
`,
  );
  return runNode([cliPath, specPath, ...args]);
}

test('the help of a const property names its fixed value, not a default', async () => {
  await using workspace = await workspaceDirectory('sdk-it-command-const-');

  const result = await intake(workspace.path, intakeSpec('https://api.test'), [
    'submitForm',
    '--help',
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(
    result.stdout,
    /--kind <value>\s+\(string, required, value: "intake"\)/,
  );
  assert.doesNotMatch(result.stdout, /default:/);
});

test('a const flag refuses any other value before a request is sent', async () => {
  await using workspace = await workspaceDirectory('sdk-it-command-const-');

  const result = await intake(
    workspace.path,
    intakeSpec('https://api.test'),
    ['submitForm', '--kind', 'other'],
    `fetch: () => Promise.reject(new Error('a request was sent')),`,
  );

  assert.notEqual(result.exitCode, 0);
  assert.match(
    result.stderr,
    /option '--kind <value>' argument 'other' is invalid\. Allowed choices are intake\./,
  );
});

test('a const flag given its value sends the request', async () => {
  await using workspace = await workspaceDirectory('sdk-it-command-const-');
  await using api = await upstream();

  const result = await intake(workspace.path, intakeSpec(api.url), [
    'submitForm',
    '--kind',
    'intake',
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { accepted: true });
});
