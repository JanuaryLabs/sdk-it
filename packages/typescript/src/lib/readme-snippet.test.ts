import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { runNode, typecheck, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const pets: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'Demo', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  age: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'The pet name',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
  },
};

async function readmeOf(spec: OpenAPIObject) {
  await using output = await new TemporaryFiles().directory('readme-snippet-');
  await generate(spec, { output: output.path, name: 'Demo', readme: true });
  return readFile(join(output.path, 'README.md'), 'utf8');
}

function typescriptBlocks(readme: string) {
  return [...readme.matchAll(/```typescript\n([\s\S]*?)```/g)].map(
    ([, code]) => code,
  );
}

test('a README request snippet is one statement that ends with one semicolon', async () => {
  const readme = await readmeOf({
    openapi: '3.1.0',
    info: { title: 'Demo', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'The pets',
              content: { 'application/json': { schema: { type: 'string' } } },
            },
          },
        },
      },
    },
  });

  assert.match(
    readme,
    /^const result = await demo\.request\('GET \/pets', \{\}\);$/m,
  );
  assert.doesNotMatch(readme, /;;/);
});

test('every README code block that uses the client type-checks against the generated SDK', async () => {
  await using workspace = await workspaceDirectory('readme-typecheck-');
  await generate(pets, {
    output: workspace.path,
    name: 'Demo',
    readme: true,
    mode: 'full',
  });
  const readme = await readFile(join(workspace.path, 'README.md'), 'utf8');
  const blocks = typescriptBlocks(readme).filter((code) =>
    /\bdemo\./.test(code),
  );

  for (const [index, code] of blocks.entries()) {
    await writeFile(
      join(workspace.path, 'src', `readme-${index}.ts`),
      `${code.replaceAll(/(['"])@demo\/sdk\1/g, "'./index.ts'")}\nexport {};\n`,
    );
  }
  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  assert.ok(blocks.length > 0);
  assert.equal(
    files.filter((file) => /src\/readme-\d+\.ts$/.test(file)).length,
    blocks.length,
  );
  assert.deepEqual(diagnostics, []);
});

test('the README error examples call the first operation of the spec', async () => {
  const readme = await readmeOf(pets);

  const errorHandling = readme.slice(
    readme.indexOf('## Error Handling'),
    readme.indexOf('## API Reference'),
  );
  const requests = [...errorHandling.matchAll(/demo\.request\('([^']+)'/g)];
  assert.deepEqual(
    requests.map(([, endpoint]) => endpoint),
    ['POST /pets', 'POST /pets', 'POST /pets'],
  );
  assert.match(errorHandling, /"name": 123/);
  assert.doesNotMatch(readme, /\/users|\/api\/data/);
});

test('the README ParseError example sends an input the client refuses', async () => {
  await using workspace = await workspaceDirectory('readme-parse-error-');
  await generate(pets, {
    output: workspace.path,
    name: 'Demo',
    readme: true,
    mode: 'full',
  });
  const readme = await readFile(join(workspace.path, 'README.md'), 'utf8');
  const [example] = typescriptBlocks(readme).filter((code) =>
    code.includes('@ts-expect-error'),
  );
  const script = join(workspace.path, 'src', 'parse-error.ts');
  await writeFile(
    script,
    example.replaceAll(/(['"])@demo\/sdk\1/g, "'./index.ts'"),
  );

  const { exitCode, stdout } = await runNode([script]);

  assert.equal(exitCode, 0);
  assert.match(stdout, /^name: /m);
});

test('the README shows no ParseError example when the first operation takes no input that can fail', async () => {
  const readme = await readmeOf({
    openapi: '3.1.0',
    info: { title: 'Demo', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/health': {
        get: {
          operationId: 'health',
          responses: { '204': { description: 'Healthy' } },
        },
      },
    },
  });

  const errorHandling = readme.slice(
    readme.indexOf('## Error Handling'),
    readme.indexOf('## API Reference'),
  );
  assert.doesNotMatch(errorHandling, /@ts-expect-error/);
  assert.doesNotMatch(errorHandling, /^### Input Validation Errors$/m);
  assert.match(errorHandling, /demo\.request\('GET \/health', \{\}\)/);
});

test('the README of a spec with no operations has no request examples', async () => {
  const readme = await readmeOf({
    openapi: '3.1.0',
    info: { title: 'Demo', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {},
  });

  assert.match(readme, /## Error Handling/);
  assert.doesNotMatch(readme, /\.request\(/);
});

test('the README logs the result itself, documents no application/empty input and no empty 422 section', async () => {
  const readme = await readmeOf(pets);

  assert.doesNotMatch(readme, /result\.data/);
  assert.match(readme, /^console\.log\(result\);?$/m);
  assert.doesNotMatch(readme, /application\/empty/);
  assert.doesNotMatch(readme, /Validation errors \(422\)/);
});
