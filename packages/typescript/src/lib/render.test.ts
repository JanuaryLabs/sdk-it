import { TemporaryFiles } from '@zukhruf/testing/fs';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate, render } from '@sdk-it/typescript';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = join(packageDir, '..', '..');

function petStore(schemas: string[]): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          tags: ['pets'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'Pets',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Pet' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createPet',
          tags: ['pets'],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: Object.fromEntries(
        schemas.map((name) => [
          name,
          { type: 'object', properties: { name: { type: 'string' } } },
        ]),
      ),
    },
  };
}

function sourceFiles(dir: string) {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.ts'))
      .map((path) => [path, readFileSync(join(dir, path), 'utf8')]),
  );
}

test('render reads and writes nothing outside the code it loads', async () => {
  await using workingFolder = await new TemporaryFiles().directory(
    'render-no-disk-',
  );
  writeFileSync(join(workingFolder.path, 'index.ts'), 'export {};');
  const script = `
    const { render } = await import(${JSON.stringify(import.meta.resolve('@sdk-it/typescript'))});
    const files = await render(${JSON.stringify(petStore(['Pet']))}, {
      name: 'Pets',
      style: { name: 'github' },
      useTsExtension: true,
    });
    process.stdout.write(String(Object.keys(files).length));
  `;

  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${repoRoot}`,
      '--input-type=module',
      '--eval',
      script,
    ],
    { cwd: workingFolder.path, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(Number(result.stdout) > 0, result.stdout);
});

for (const agentTools of ['ai-sdk', 'openai-agents'] as const) {
  test(`render output without .ts extensions compiles where .ts imports are not allowed (${agentTools})`, async () => {
    await using directory = await workspaceDirectory('render-no-ts-extension-');
    const files = await render(petStore(['Pet', 'Tag']), {
      name: 'Pets',
      style: { name: 'github' },
      useTsExtension: false,
      agentTools,
    });
    await writeFiles(directory.path, files);
    writeFileSync(
      join(directory.path, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          moduleResolution: 'bundler',
          skipLibCheck: true,
          noEmit: true,
          verbatimModuleSyntax: true,
        },
        include: ['**/*.ts'],
      }),
    );

    const checked = typecheck(join(directory.path, 'tsconfig.json'));

    assert.ok(checked.files.some((file) => file.startsWith(directory.path)));
    assert.deepStrictEqual(checked.diagnostics, []);
  });
}

test('generate writes metadata.json through a writer that keeps files in memory', async () => {
  await using directory = await new TemporaryFiles().directory(
    'render-in-memory-',
  );
  const output = join(directory.path, 'sdk');
  const written: string[] = [];

  await generate(petStore(['Pet']), {
    output,
    readme: false,
    writer: async (folder, contents) => {
      for (const file of Object.keys(contents)) {
        written.push(relative(output, join(folder, file)));
      }
    },
  });

  assert.ok(written.includes('metadata.json'), written.join('\n'));
  assert.equal(existsSync(output), false);
});

test('generate leaves the caller settings unchanged across runs', async () => {
  await using directory = await new TemporaryFiles().directory(
    'render-settings-',
  );
  let writes = 0;
  const settings = {
    output: directory.path,
    readme: false,
    writer: async (
      folder: string,
      contents: Parameters<typeof writeFiles>[1],
    ) => {
      writes++;
      await writeFiles(folder, contents);
    },
  };
  const before = { ...settings };
  await generate(petStore(['Pet']), settings);
  const firstRunWrites = writes;

  await generate(petStore(['Pet']), settings);

  assert.deepStrictEqual(settings, before);
  assert.ok(writes > firstRunWrites);
});

test('a regenerated SDK keeps exporting a model the user added', async () => {
  await using directory = await new TemporaryFiles().directory(
    'render-user-file-',
  );
  const settings = { output: directory.path, readme: false, cleanup: false };
  await generate(petStore(['Pet']), settings);
  writeFileSync(
    join(directory.path, 'models', 'custom.ts'),
    'export type Custom = 1;',
  );
  writeFileSync(join(directory.path, 'models', 'notes.md'), '# Notes');
  mkdirSync(join(directory.path, 'models', 'extra'));
  writeFileSync(
    join(directory.path, 'models', 'extra', 'index.ts'),
    'export type Extra = 1;',
  );

  await generate(petStore(['Pet']), settings);

  const index = readFileSync(
    join(directory.path, 'models', 'index.ts'),
    'utf8',
  );
  assert.match(index, /^export \* from '\.\/custom\.ts';$/m);
  assert.match(index, /^export \* from '\.\/extra\/index\.ts';$/m);
  assert.doesNotMatch(index, /notes/);
});

test('without cleanup, a model removed from the spec stays exported', async () => {
  await using directory = await new TemporaryFiles().directory(
    'render-stale-file-',
  );
  const settings = { output: directory.path, readme: false, cleanup: false };
  const tagExport = /^export \* from '\.\/tag\.ts';$/m;
  await generate(petStore(['Pet', 'Tag']), settings);
  assert.match(
    readFileSync(join(directory.path, 'models', 'index.ts'), 'utf8'),
    tagExport,
  );

  await generate(petStore(['Pet']), settings);

  assert.match(
    readFileSync(join(directory.path, 'models', 'index.ts'), 'utf8'),
    tagExport,
  );
});

for (const [agentTools, useTsExtension] of [
  ['ai-sdk', true],
  ['openai-agents', false],
] as const) {
  test(`render returns the source files generate writes (${agentTools}, useTsExtension ${useTsExtension})`, async () => {
    await using directory = await new TemporaryFiles().directory(
      'render-parity-',
    );
    await generate(petStore(['Pet', 'Tag']), {
      output: directory.path,
      name: 'Pets',
      readme: false,
      agentTools,
      useTsExtension,
      mode: 'full',
    });

    const files = await render(petStore(['Pet', 'Tag']), {
      name: 'Pets',
      style: { name: 'github' },
      useTsExtension,
      agentTools,
    });

    assert.ok(
      files['index.ts'] && files['agents.ts'] && files['http/security.ts'],
      Object.keys(files).join(),
    );
    assert.deepStrictEqual(files, sourceFiles(join(directory.path, 'src')));
  });
}
