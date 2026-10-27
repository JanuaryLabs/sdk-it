import assert from 'node:assert/strict';
import { EventEmitter, on } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type Plugin, build, createServer } from 'vite';

import { writeFiles } from '@sdk-it/core/file-system.js';
import sdkIt from '@sdk-it/vite';

const rootSpec = (paths: string) => `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
${paths}`;

const petsPath = `
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './schemas/pet.yaml' }
`;

const tagsPath = `
  /tags:
    get:
      operationId: listTags
      responses:
        '200':
          description: Tags
          content:
            application/json:
              schema: { $ref: './schemas/tag.yaml' }
`;

const objectWith = (...properties: string[]) =>
  `type: object\nproperties:\n${properties.map((name) => `  ${name}: { type: string }`).join('\n')}\n`;

// The spec lives outside the vite root, as in a monorepo whose backend owns
// it, so vite's own watcher does not see its files.
function workspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'vite-multi-file-'));
  const app = join(dir, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'main.js'), '');
  for (const [path, content] of Object.entries(files)) {
    write(join(dir, 'api', path), content);
  }
  return { dir, app, api: (path: string) => join(dir, 'api', path) };
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function generatedModels() {
  const written = new EventEmitter();
  const latest = new Map<string, string>();
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    latest,
    writer: async (dir: string, contents: Parameters<typeof writeFiles>[1]) => {
      writes++;
      await writeFiles(dir, contents);
      for (const [file, content] of Object.entries(contents)) {
        const model = /(?:models|outputs)\/([\w-]+)\.ts$/.exec(file)?.[1];
        if (model && typeof content === 'string') {
          latest.set(model, content);
          written.emit('model', model, content);
        }
      }
    },
    /** Resolves when a generated `model` next contains `text`. */
    async next(model: string, text: string) {
      for await (const [name, content] of on(written, 'model', {
        signal: AbortSignal.timeout(10_000),
      })) {
        if (name === model && content.includes(text)) {
          return;
        }
      }
    },
  };
}

function plugin(output: string, writer: ReturnType<typeof generatedModels>) {
  return sdkIt('../api/openapi.yaml', {
    output,
    writer: writer.writer,
    cleanup: false,
    readme: false,
  });
}

function buildWith(plugin: Plugin, root: string) {
  return build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: { rollupOptions: { input: join(root, 'main.js') }, write: false },
    plugins: [plugin],
  });
}

function serveWith(plugin: Plugin, root: string) {
  return createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    server: { middlewareMode: true },
    plugins: [plugin],
  });
}

// A model is written mid-generation. A build with unchanged files shares the
// in-flight generation, so awaiting it lets the generation finish before the
// test removes its output.
function settle(plugin: Plugin, root: string) {
  return buildWith(plugin, root);
}

// The watcher has no public signal for when a newly added path is scanned,
// so the edit is repeated until the regenerated model shows it.
async function editUntil(path: string, content: string, done: Promise<void>) {
  const editing = setInterval(() => write(path, content), 200);
  try {
    write(path, content);
    await done;
  } finally {
    clearInterval(editing);
  }
}

test('a build after a referenced file changes regenerates the SDK', async () => {
  const { dir, app, api } = workspace({
    'openapi.yaml': rootSpec(petsPath),
    'schemas/pet.yaml': objectWith('name'),
  });
  try {
    const models = generatedModels();
    const sdk = plugin(join(dir, 'sdk'), models);
    await buildWith(sdk, app);

    write(api('schemas/pet.yaml'), objectWith('name', 'nickname'));
    await buildWith(sdk, app);

    assert.match(models.latest.get('pet') ?? '', /nickname/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a build with unchanged referenced files does not regenerate the SDK', async () => {
  const { dir, app } = workspace({
    'openapi.yaml': rootSpec(petsPath),
    'schemas/pet.yaml': objectWith('name'),
  });
  try {
    const models = generatedModels();
    const sdk = plugin(join(dir, 'sdk'), models);
    await buildWith(sdk, app);
    const firstWrites = models.writes;

    await buildWith(sdk, app);

    assert.ok(firstWrites > 0);
    assert.equal(models.writes, firstWrites);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the dev server regenerates the SDK when a referenced file changes', async () => {
  const { dir, app, api } = workspace({
    'openapi.yaml': rootSpec(petsPath),
    'schemas/pet.yaml': objectWith('name'),
  });
  const models = generatedModels();
  const generated = models.next('pet', 'name');
  const sdk = plugin(join(dir, 'sdk'), models);
  const server = await serveWith(sdk, app);
  try {
    await generated;

    await editUntil(
      api('schemas/pet.yaml'),
      objectWith('name', 'nickname'),
      models.next('pet', 'nickname'),
    );
    await settle(sdk, app);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the dev server watches a file the spec starts to reference after an edit', async () => {
  const { dir, app, api } = workspace({
    'openapi.yaml': rootSpec(petsPath),
    'schemas/pet.yaml': objectWith('name'),
    'schemas/tag.yaml': objectWith('label'),
  });
  const models = generatedModels();
  const generated = models.next('pet', 'name');
  const sdk = plugin(join(dir, 'sdk'), models);
  const server = await serveWith(sdk, app);
  try {
    await generated;
    await editUntil(
      api('openapi.yaml'),
      rootSpec(petsPath + tagsPath),
      models.next('tag', 'label'),
    );

    await editUntil(
      api('schemas/tag.yaml'),
      objectWith('label', 'color'),
      models.next('tag', 'color'),
    );
    await settle(sdk, app);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
