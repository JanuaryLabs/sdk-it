import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
  mkdtempDisposable,
  readFile,
  readlink,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeFiles } from '@sdk-it/core/file-system.js';

void test.each(['relative', 'absolute'] as const, (pathKind) =>
  test(`ignoreIfExists preserves a competing scaffold at a ${pathKind} path`, async () => {
    await using workspace = await mkdtempDisposable(
      join(tmpdir(), 'sdk-it-exclusive-'),
    );
    const path = join(workspace.path, 'nested', 'package.json');
    const authored = '{"name":"user-owned"}';

    await writeFiles(workspace.path, {
      [pathKind === 'absolute' ? path : 'nested/package.json']: {
        ignoreIfExists: true,
        get content() {
          // Create a real competing file while supplying the public writer input.
          // This schedules the race without mocking filesystem calls or timers.
          writeFileSync(path, authored, { flag: 'wx' });
          return '{"name":"generated"}';
        },
      },
    });

    assert.equal(await readFile(path, 'utf8'), authored);
  }),
);

test('concurrent scaffold writers leave one complete winner', async () => {
  await using workspace = await mkdtempDisposable(
    join(tmpdir(), 'sdk-it-writers-'),
  );
  const candidates = Array.from({ length: 12 }, (_, index) =>
    JSON.stringify({
      name: `client-${index}`,
      data: String(index).repeat(8192 * (index + 1)),
    }),
  );

  await Promise.all(
    candidates.map((content) =>
      writeFiles(workspace.path, {
        'package.json': { content, ignoreIfExists: true },
      }),
    ),
  );

  const actual = await readFile(join(workspace.path, 'package.json'), 'utf8');
  assert.ok(
    candidates.includes(actual),
    'the file must contain exactly one complete candidate',
  );
});

test('ignoreIfExists preserves a dangling symlink without creating its target', async () => {
  await using workspace = await mkdtempDisposable(
    join(tmpdir(), 'sdk-it-symlink-'),
  );
  const path = join(workspace.path, 'package.json');
  const target = join(workspace.path, 'user-package.json');
  await symlink(target, path);

  await writeFiles(workspace.path, {
    'package.json': { content: 'generated', ignoreIfExists: true },
  });

  assert.equal(await readlink(path), target);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
});

test('ignoreIfExists propagates failures other than an occupied destination', async () => {
  await using workspace = await mkdtempDisposable(
    join(tmpdir(), 'sdk-it-write-error-'),
  );
  await writeFile(join(workspace.path, 'parent'), 'user-owned');

  await assert.rejects(
    writeFiles(workspace.path, {
      'parent/package.json': { content: 'generated', ignoreIfExists: true },
    }),
  );

  assert.equal(
    await readFile(join(workspace.path, 'parent'), 'utf8'),
    'user-owned',
  );
});
