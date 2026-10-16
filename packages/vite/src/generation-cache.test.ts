import { settleWithin } from '@zukhruf/testing/async';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { type Plugin, build } from 'vite';

import { writeFiles } from '@sdk-it/core/file-system.js';
import sdkIt from '@sdk-it/vite';

function spec(operationId: string): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: operationId, version: '1.0.0' },
    paths: {
      [`/${operationId}`]: {
        get: {
          operationId,
          tags: ['example'],
          responses: {
            '200': {
              description: 'Value',
              content: { 'application/json': { schema: { type: 'string' } } },
            },
          },
        },
      },
    },
  };
}

function buildWith(plugin: Plugin, root: string, ...observers: Plugin[]) {
  return build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: { rollupOptions: { input: join(root, 'main.js') }, write: false },
    plugins: [plugin, ...observers],
  });
}

void test.each(['object', 'file', 'function'] as const, (source) =>
  test(`${source} builds restore generated SDK content after A to B to A`, async () => {
    await using workspace = await mkdtempDisposable(
      join(tmpdir(), 'sdk-it-vite-cache-'),
    );
    await writeFile(join(workspace.path, 'main.js'), '');
    const output = join(workspace.path, 'sdk');
    const formatted: string[] = [];
    const snapshots: string[] = [];

    for (const operation of ['getAlpha', 'getBeta', 'getAlpha', 'getAlpha']) {
      const document = spec(operation);
      await writeFile(
        join(workspace.path, 'openapi.json'),
        JSON.stringify(document),
      );
      await buildWith(
        sdkIt(
          source === 'object'
            ? document
            : source === 'file'
              ? 'openapi.json'
              : async () => 'openapi.json',
          {
            output,
            readme: false,
            formatCode: () => {
              formatted.push(operation);
            },
          },
        ),
        workspace.path,
      );
      snapshots.push(await readFile(join(output, 'api', 'example.ts'), 'utf8'));
    }

    assert.notEqual(
      snapshots[0],
      snapshots[1],
      'A and B must generate different clients',
    );
    assert.equal(
      snapshots[2],
      snapshots[0],
      'returning to A must restore its client',
    );
    assert.equal(snapshots[3], snapshots[0]);
    assert.deepEqual(
      formatted,
      ['getAlpha', 'getBeta', 'getAlpha'],
      'only the latest completed generation can be reused',
    );
  }),
);

test('concurrent different specs serialize writes and formatting for one output', async () => {
  await using workspace = await mkdtempDisposable(
    join(tmpdir(), 'sdk-it-vite-concurrent-'),
  );
  await writeFile(join(workspace.path, 'main.js'), '');
  const output = join(workspace.path, 'sdk');
  const active = new Set<string>();
  const completed: string[] = [];
  let overlapping = false;

  const results = await Promise.allSettled(
    ['getAlpha', 'getBeta', 'getGamma'].map((operation) =>
      buildWith(
        sdkIt(spec(operation), {
          output: operation === 'getBeta' ? `${output}/.` : output,
          readme: false,
          async writer(directory, contents) {
            active.add(operation);
            overlapping ||= active.size > 1;
            await setImmediate();
            await writeFiles(directory, contents);
          },
          async formatCode({ output }) {
            await setImmediate();
            await writeFile(join(output, 'formatted.txt'), operation);
            active.delete(operation);
            completed.push(operation);
          },
        }),
        workspace.path,
      ),
    ),
  );

  assert.equal(
    overlapping,
    false,
    'different generations must never write the same output concurrently',
  );
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'fulfilled', 'fulfilled'],
  );
  assert.equal(completed.length, 3);
  assert.equal(active.size, 0);
  assert.equal(
    await readFile(join(output, 'formatted.txt'), 'utf8'),
    completed.at(-1),
  );
  const client = await readFile(join(output, 'api', 'example.ts'), 'utf8');
  assert.ok(
    client.includes(completed[2]),
    'final client must match the last complete generation',
  );
});

void test.each([false, true], (failFirst) =>
  test(`queued A to B to A restores A after the first generation ${failFirst ? 'fails' : 'succeeds'}`, async () => {
    await using workspace = await mkdtempDisposable(
      join(tmpdir(), 'sdk-it-vite-queue-'),
    );
    await writeFile(join(workspace.path, 'main.js'), '');
    const output = join(workspace.path, 'sdk');
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const formatted: string[] = [];
    const firstFailure = new Error('first formatter failed');
    const alpha = sdkIt(spec('getAlpha'), {
      output,
      readme: false,
      async formatCode() {
        formatted.push('A');
        if (formatted.length === 1) {
          entered.resolve();
          await release.promise;
          if (failFirst) throw firstFailure;
        }
      },
    });
    const beta = sdkIt(spec('getBeta'), {
      output,
      readme: false,
      formatCode() {
        formatted.push('B');
      },
    });
    const first = buildWith(alpha, workspace.path);
    // Attach rejection handling before releasing a failing formatter.
    const builds = [first];
    let settled = Promise.allSettled(builds);
    try {
      await settleWithin(entered.promise, 'first generation formatter');
      for (const plugin of [beta, beta, alpha]) {
        const queued = Promise.withResolvers<void>();
        builds.push(
          buildWith(plugin, workspace.path, {
            name: 'observe-build-start',
            buildStart: {
              order: 'post',
              handler() {
                queued.resolve();
              },
            },
          }),
        );
        settled = Promise.allSettled(builds);
        await settleWithin(queued.promise, 'subsequent Vite build start');
      }
    } finally {
      release.resolve();
      await settled;
    }
    const results = await settled;
    assert.deepEqual(
      results.map((result) => result.status),
      [
        failFirst ? 'rejected' : 'fulfilled',
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ],
    );
    if (results[0].status === 'rejected')
      assert.match(results[0].reason.message, /first formatter failed/);
    await buildWith(alpha, workspace.path);
    assert.deepEqual(
      formatted,
      ['A', 'B', 'A'],
      'queued duplicate B shares work and completed A stays cached',
    );
    const client = await readFile(join(output, 'api', 'example.ts'), 'utf8');
    assert.match(client, /getAlpha/);
    assert.doesNotMatch(client, /getBeta/);
  }),
);
