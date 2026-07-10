import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { type Plugin, build, createServer } from 'vite';

import { generateProject, loadProjectConfig } from '@sdk-it/cli';
import { writeFiles } from '@sdk-it/core/file-system.js';
import sdkIt from '@sdk-it/vite';

const minimalSpec = {
  openapi: '3.1.0' as const,
  info: { title: 'Test', version: '1.0.0' },
  paths: {},
};
const repoRoot = join(import.meta.dirname, '..', '..', '..');

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
  const tempDirs: string[] = [];
  const servers: Awaited<ReturnType<typeof createServer>>[] = [];

  function makeTempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'vite-test-'));
    writeFileSync(join(dir, 'main.js'), '');
    tempDirs.push(dir);
    return dir;
  }

  function makeProjectWorkspace(configPath: string, configSource: string) {
    const root = makeTempDir();
    symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
    mkdirSync(join(root, 'backend'));
    writeFileSync(
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
    writeFileSync(
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
    mkdirSync(dirname(absoluteConfigPath), { recursive: true });
    writeFileSync(absoluteConfigPath, configSource);
    return root;
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

  afterEach(async () => {
    for (const server of servers) {
      await server.close();
    }
    servers.length = 0;
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test('specPlugin: multi-phase build generates only once', async () => {
    const tracker = trackingWriter();
    const root = makeTempDir();
    const plugin = sdkIt(minimalSpec, {
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
    const tempDir = makeTempDir();
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    const tracker = trackingWriter();
    const plugin = sdkIt(async () => 'openapi.json', {
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
    const root = makeTempDir();
    const output = join(root, 'sdk');
    const tracker = trackingWriter();

    const pluginA = sdkIt(minimalSpec, {
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
    const root = makeTempDir();
    const tracker = trackingWriter();
    const plugin = sdkIt(minimalSpec, {
      output: join(root, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    await buildWith(plugin, root);
    const singleRunWrites = tracker.calls;

    tracker.reset();
    const root2 = makeTempDir();
    const plugin2 = sdkIt(
      { ...minimalSpec, info: { title: 'Concurrent', version: '2.0.0' } },
      {
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
    const root = makeTempDir();
    const tracker = trackingWriter();
    const plugin = sdkIt(minimalSpec, {
      output: join(root, 'sdk'),
      writer: tracker.writer,
      cleanup: false,
      readme: false,
    });

    const server = await serveWith(plugin, root);
    servers.push(server);
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
    const tempDir = makeTempDir();
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    const tracker = trackingWriter();
    const plugin = sdkIt('openapi.json', {
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
    const tempDir = makeTempDir();
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    const tracker = trackingWriter();
    const plugin = sdkIt('openapi.json', {
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
    const tempDir = makeTempDir();
    const specPath = join(tempDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(minimalSpec));

    let shouldFail = true;
    let generateAttempts = 0;
    const plugin = sdkIt('openapi.json', {
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
    const root = makeProjectWorkspace(
      'sdk-it.config.ts',
      `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './backend/tsconfig.json',
});
`,
    );

    const config = await loadProjectConfig({ cwd: root });
    const cliOutput = join(root, '.cli-sdk');
    await generateProject({ ...config, output: cliOutput });
    const cliEndpoint = readFileSync(
      join(cliOutput, 'src', 'api', 'books.ts'),
      'utf8',
    );

    await buildWith((sdkIt as unknown as () => Plugin)(), root);

    const viteEndpoint = readFileSync(
      join(root, '.sdk-it', 'src', 'api', 'books.ts'),
      'utf8',
    );
    assert.equal(viteEndpoint, cliEndpoint);
  });

  test('project plugin accepts an explicit project config path', async () => {
    const root = makeProjectWorkspace(
      'config/project.ts',
      `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: '../backend/tsconfig.json',
  output: '../explicit-sdk',
});
`,
    );

    await buildWith(sdkIt({ config: 'config/project.ts' }), root);

    const endpoint = readFileSync(
      join(root, 'explicit-sdk', 'src', 'api', 'books.ts'),
      'utf8',
    );
    assert.match(endpoint, /"GET \/books"/);
  });
});
