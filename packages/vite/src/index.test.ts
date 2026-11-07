import { type TemporaryDirectory, TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { type Plugin, build, createServer } from 'vite';

import { generateProject, loadProjectConfig } from '@sdk-it/cli';
import { writeFiles } from '@sdk-it/core/file-system.js';
import { workspaceDirectory } from '@sdk-it/testing';
import sdkIt from '@sdk-it/vite';

const minimalSpec = {
  openapi: '3.1.0' as const,
  info: { title: 'Test', version: '1.0.0' },
  paths: {},
};

function buildWith(plugin: Plugin, root: string) {
  return build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: {
      rollupOptions: { input: join(root, 'main.js') },
      write: false,
    },
    plugins: [plugin],
  });
}

function serveWith(plugin: Plugin, root: string) {
  return createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [plugin],
  });
}

describe('sdkIt', () => {
  async function viteRoot(directory: Promise<TemporaryDirectory>) {
    await using pending = new AsyncDisposableStack();
    const root = pending.use(await directory);
    await writeFile(join(root.path, 'main.js'), '');
    pending.move();
    return root;
  }

  async function makeProjectWorkspace(
    configPath: string,
    configSource: string,
  ) {
    await using pending = new AsyncDisposableStack();
    const workspace = pending.use(
      await viteRoot(workspaceDirectory('vite-project-')),
    );
    const root = workspace.path;
    await mkdir(join(root, 'backend'));
    await writeFile(
      join(root, 'backend', 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          skipLibCheck: true,
          target: 'esnext',
        },
        include: ['src.ts'],
      }),
    );
    await writeFile(
      join(root, 'backend', 'src.ts'),
      `
import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

const app = new Hono();

/** @openapi listBooks @tags books */
app.get(
  '/books',
  validate((payload) => ({
    author: {
      select: payload.query.author,
      against: z.string().optional(),
    },
  })),
  (context) => context.json([{ id: 'book-1' }]),
);
`,
    );
    const absoluteConfigPath = join(root, configPath);
    await mkdir(dirname(absoluteConfigPath), { recursive: true });
    await writeFile(absoluteConfigPath, configSource);
    pending.move();
    return workspace;
  }

  function trackingWriter() {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      reset() {
        calls = 0;
      },
      writer: async (
        dir: string,
        contents: Parameters<typeof writeFiles>[1],
      ) => {
        calls++;
        await writeFiles(dir, contents);
      },
    };
  }

  test('specPlugin: multi-phase build generates only once', async () => {
    const tracker = trackingWriter();
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const root = workspace.path;
    const plugin = sdkIt(minimalSpec, {
      name: 'Example',
      output: join(root, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    await buildWith(plugin, root);
    const firstPhaseWrites = tracker.calls;

    tracker.reset();
    await buildWith(plugin, root);

    assert.ok(firstPhaseWrites > 0, 'first build should trigger generation');
    assert.equal(
      tracker.calls,
      0,
      'subsequent build should not trigger generation',
    );
  });

  test('functionPlugin: async relative file source generates through the vite lifecycle', async () => {
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const tempDir = workspace.path;
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    const tracker = trackingWriter();
    const plugin = sdkIt(async () => 'openapi.json', {
      name: 'Example',
      output: join(tempDir, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    await buildWith(plugin, tempDir);

    assert.ok(
      tracker.calls > 0,
      'async function sources returning a relative file should generate an SDK',
    );
  });

  test('specPlugin: different spec content triggers new generation', async () => {
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const root = workspace.path;
    const output = join(root, 'sdk');
    const tracker = trackingWriter();

    const pluginA = sdkIt(minimalSpec, {
      name: 'Example',
      output,
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    await buildWith(pluginA, root);
    const firstWrites = tracker.calls;

    tracker.reset();
    const pluginB = sdkIt(
      { ...minimalSpec, info: { title: 'Different', version: '2.0.0' } },
      {
        name: 'Example',
        output,
        writer: tracker.writer,
        cleanup: false,
        readme: false,
      },
    );

    await buildWith(pluginB, root);

    assert.ok(firstWrites > 0);
    assert.ok(
      tracker.calls > 0,
      'changed spec content should trigger new generation',
    );
  });

  test('specPlugin: concurrent builds share one generation', async () => {
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const root = workspace.path;
    const tracker = trackingWriter();
    const plugin = sdkIt(minimalSpec, {
      name: 'Example',
      output: join(root, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    await buildWith(plugin, root);
    const singleRunWrites = tracker.calls;

    tracker.reset();
    await using workspace2 = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const root2 = workspace2.path;
    const plugin2 = sdkIt(
      { ...minimalSpec, info: { title: 'Concurrent', version: '2.0.0' } },
      {
        name: 'Example',
        output: join(root2, 'sdk'),
        writer: tracker.writer,
        cleanup: false,
        readme: false,
      },
    );

    await Promise.all([
      buildWith(plugin2, root2),
      buildWith(plugin2, root2),
      buildWith(plugin2, root2),
    ]);

    assert.equal(
      tracker.calls,
      singleRunWrites,
      'concurrent calls should produce same write count as single generation',
    );
  });

  test('specPlugin: dev server then build generates only once', async () => {
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const root = workspace.path;
    const tracker = trackingWriter();
    const plugin = sdkIt(minimalSpec, {
      name: 'Example',
      output: join(root, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    const server = await serveWith(plugin, root);
    await using _server = { [Symbol.asyncDispose]: () => server.close() };
    const afterServerWrites = tracker.calls;

    tracker.reset();
    await buildWith(plugin, root);

    assert.ok(
      afterServerWrites > 0,
      'creating dev server should trigger generation',
    );
    assert.equal(
      tracker.calls,
      0,
      'build after dev server should skip generation',
    );
  });

  test('filePlugin: multi-phase build generates only once', async () => {
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const tempDir = workspace.path;
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    const tracker = trackingWriter();
    const plugin = sdkIt('openapi.json', {
      name: 'Example',
      output: join(tempDir, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    await buildWith(plugin, tempDir);
    const firstPhaseWrites = tracker.calls;

    tracker.reset();
    await buildWith(plugin, tempDir);

    assert.ok(firstPhaseWrites > 0, 'first build should trigger generation');
    assert.equal(
      tracker.calls,
      0,
      'subsequent build should not trigger generation',
    );
  });

  test('filePlugin: changed file content triggers new generation', async () => {
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const tempDir = workspace.path;
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    const tracker = trackingWriter();
    const plugin = sdkIt('openapi.json', {
      name: 'Example',
      output: join(tempDir, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    await buildWith(plugin, tempDir);
    const firstWrites = tracker.calls;

    tracker.reset();
    writeFileSync(
      specPath,
      JSON.stringify({
        ...minimalSpec,
        info: { title: 'Updated', version: '2.0.0' },
      }),
    );
    await buildWith(plugin, tempDir);

    assert.ok(firstWrites > 0);
    assert.ok(
      tracker.calls > 0,
      'changed file content should trigger new generation',
    );
  });

  test('filePlugin: generation failure allows retry', async () => {
    await using workspace = await viteRoot(
      new TemporaryFiles().directory('vite-test-'),
    );
    const tempDir = workspace.path;
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    let shouldFail = true;
    let generateAttempts = 0;
    const plugin = sdkIt('openapi.json', {
      name: 'Example',
      output: join(tempDir, 'sdk'),
      writer: async (dir, contents) => {
        generateAttempts++;
        if (shouldFail) {
          throw new Error('generation failed');
        }
        await writeFiles(dir, contents);
      },
      cleanup: false,
      readme: false,
    });

    await assert.rejects(() => buildWith(plugin, tempDir), /generation failed/);
    const failedAttempts = generateAttempts;

    shouldFail = false;
    generateAttempts = 0;
    await buildWith(plugin, tempDir);

    assert.ok(failedAttempts > 0, 'first attempt should have tried');
    assert.ok(
      generateAttempts > 0,
      'retry after failure should trigger new generation',
    );
  });

  test('project plugin produces the same client as CLI generation', async () => {
    await using workspace = await makeProjectWorkspace(
      'sdk-it.config.ts',
      `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  name: 'Example',
  tsconfig: './backend/tsconfig.json',
});
`,
    );
    const root = workspace.path;

    const config = await loadProjectConfig({ cwd: root });
    const cliOutput = join(root, '.cli-sdk');
    await generateProject({ ...config, output: cliOutput });
    const cliEndpoint = readFileSync(
      join(cliOutput, 'src', 'api', 'books.ts'),
      'utf8',
    );

    await buildWith(sdkIt(), root);

    const viteEndpoint = readFileSync(
      join(root, '.sdk-it', 'src', 'api', 'books.ts'),
      'utf8',
    );
    assert.equal(viteEndpoint, cliEndpoint);
  });

  test('project plugin accepts an explicit project config path', async () => {
    await using workspace = await makeProjectWorkspace(
      'config/project.ts',
      `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  name: 'Example',
  tsconfig: '../backend/tsconfig.json',
  output: '../explicit-sdk',
});
`,
    );
    const root = workspace.path;

    await buildWith(sdkIt({ config: 'config/project.ts' }), root);

    const endpoint = readFileSync(
      join(root, 'explicit-sdk', 'src', 'api', 'books.ts'),
      'utf8',
    );
    assert.match(endpoint, /"GET \/books"/);
  });
});
