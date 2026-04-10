import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { type Plugin, build, createServer } from 'vite';

import { writeFiles } from '@sdk-it/core/file-system.js';

import sdkIt from './index.ts';

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
  const tempDirs: string[] = [];
  const servers: Awaited<ReturnType<typeof createServer>>[] = [];

  function makeTempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'vite-test-'));
    writeFileSync(join(dir, 'main.js'), '');
    tempDirs.push(dir);
    return dir;
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
});
