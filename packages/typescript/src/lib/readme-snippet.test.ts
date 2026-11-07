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
  await generate(spec, {
    output: output.path,
    name: 'Demo',
    packageName: '@acme/pets',
    readme: true,
  });
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

const catalog: OpenAPIObject = {
  ...pets,
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  },
  security: [{ bearer: [] }, { apiKey: [] }],
  paths: {
    ...pets.paths,
    '/owners/{ownerId}/pets': {
      get: {
        operationId: 'listOwnerPets',
        parameters: [
          {
            name: 'ownerId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
          {
            name: 'X-Trace',
            in: 'header',
            description: 'A trace id',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'A page of pets',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { type: 'string' } },
                    hasMore: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/pets/{petId}/photo': {
      get: {
        operationId: 'downloadPhoto',
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
            description: 'The photo',
            content: {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
    },
  },
};

function section(readme: string, heading: string) {
  const start = readme.indexOf(heading);
  assert.notEqual(start, -1, `${heading} is in the README`);
  const end = readme.indexOf('\n### ', start + heading.length);
  return readme.slice(start, end === -1 ? undefined : end);
}

test('every README code block that uses the client type-checks against the generated SDK', async () => {
  await using workspace = await workspaceDirectory('readme-typecheck-');
  await generate(catalog, {
    output: workspace.path,
    name: 'Demo',
    packageName: '@acme/pets',
    readme: true,
    mode: 'full',
  });
  const readme = await readFile(join(workspace.path, 'README.md'), 'utf8');
  const blocks = typescriptBlocks(readme).filter((code) =>
    /\b(demo|createDemo)\b/.test(code),
  );

  for (const [index, code] of blocks.entries()) {
    await writeFile(
      join(workspace.path, 'src', `readme-${index}.ts`),
      `${code.replaceAll(/(['"])@acme\/pets\1/g, "'./index.ts'")}\nexport {};\n`,
    );
  }
  const { files, diagnostics } = typecheck(
    join(workspace.path, 'tsconfig.json'),
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(
    files.filter((file) => /src\/readme-\d+\.ts$/.test(file)).length,
    blocks.length,
  );
  assert.ok(blocks.some((code) => code.includes('iterPages')));
  assert.ok(blocks.some((code) => code.includes("'GET /pets/{petId}/photo'")));
  assert.ok(blocks.some((code) => code.includes('"apiKey":')));
});

test('the package.json and the README name the package that generate is given', async () => {
  await using output = await new TemporaryFiles().directory('readme-package-');
  const { packageName } = await generate(pets, {
    output: output.path,
    name: 'Demo',
    packageName: '@acme/pets',
    readme: true,
    mode: 'full',
  });
  const manifest = JSON.parse(
    await readFile(join(output.path, 'package.json'), 'utf8'),
  );
  const readme = await readFile(join(output.path, 'README.md'), 'utf8');

  assert.equal(packageName, '@acme/pets');
  assert.equal(manifest.name, '@acme/pets');
  assert.match(readme, /^npm install @acme\/pets$/m);
  assert.match(readme, /from '@acme\/pets';/);
  assert.doesNotMatch(readme, /@demo\/sdk/);
});

test("the README pagination section calls the spec's paginated operation", async () => {
  const readme = await readmeOf(catalog);

  const pagination = readme.slice(
    readme.indexOf('## Pagination'),
    readme.indexOf('## Error Handling'),
  );
  const endpoints = new Set(
    [...pagination.matchAll(/demo\.request\('([^']+)'/g)].map(
      ([, endpoint]) => endpoint,
    ),
  );
  assert.deepEqual([...endpoints], ['GET /owners/{ownerId}/pets']);
  assert.match(pagination, /"ownerId": "example"/);
  assert.match(pagination, /`offset` and `limit`/);
  assert.doesNotMatch(readme, /\/products|pageSize/);
});

test('the README of a spec without a paginated operation has no pagination section', async () => {
  const readme = await readmeOf(pets);

  assert.doesNotMatch(readme, /^## Pagination$/m);
  assert.doesNotMatch(readme, /iterPages/);
});

test("a bodyless operation's input documents its parameters and no unknown type", async () => {
  const readme = await readmeOf(catalog);

  const input = section(
    readme,
    '### listOwnerPets | _GET /owners/{ownerId}/pets_',
  ).split('#### Input')[1];
  assert.ok(input, 'the operation has an Input section');
  const documented = input.slice(0, input.indexOf('#### Output'));
  assert.match(
    documented,
    /^\| `ownerId` \| path \| `string` \| Yes \| {2}\|$/m,
  );
  assert.match(
    documented,
    /^\| `limit` \| query \| `integer` \| No \| {2}\|$/m,
  );
  assert.match(
    documented,
    /^\| `X-Trace` \| header \| `string` \| No \| A trace id \|$/m,
  );
  assert.doesNotMatch(documented, /unknown|ListOwnerPetsInput/);
  assert.doesNotMatch(readme, /listownerpetsinput/);
});

test('the README stream download reads the stream with the Web Streams API', async () => {
  const readme = await readmeOf(catalog);

  const [download] = typescriptBlocks(
    section(readme, '### downloadPhoto | _GET /pets/{petId}/photo_'),
  );
  assert.match(download, /^for await \(const chunk of stream\) \{$/m);
  assert.doesNotMatch(download, /writeFile|node:/);
});

test('a README authentication block imports the client it creates', async () => {
  const readme = await readmeOf(catalog);

  const authentication = readme.slice(
    readme.indexOf('## Authentication'),
    readme.indexOf('## Pagination'),
  );
  const blocks = typescriptBlocks(authentication);
  assert.equal(blocks.length, 2);
  for (const code of blocks) {
    assert.match(code, /^import \{ createDemo \} from '@acme\/pets';$/m);
  }
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
    packageName: '@acme/pets',
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
    example.replaceAll(/(['"])@acme\/pets\1/g, "'./index.ts'"),
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
