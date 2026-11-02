import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { cleanFiles, readWriteMetadata } from '@sdk-it/spec';

describe('Metadata File Management - Error-First Testing', () => {
  let testDir: string;

  before(async () => {
    testDir = join(tmpdir(), `metadata-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('readWriteMetadata - Attack Phase: Unreadable metadata.json', () => {
    for (const [name, content] of [
      ['malformed JSON', '{ invalid json }'],
      ['binary content', Buffer.from([0x00, 0x01, 0xff, 0xfe])],
      ['an empty file', ''],
    ] as const) {
      it(`should reject a metadata.json holding ${name}`, async () => {
        const dir = await mkdtemp(join(tmpdir(), 'metadata-unreadable-'));
        try {
          await writeFile(join(dir, 'metadata.json'), content);

          await assert.rejects(
            () => readWriteMetadata(dir, ['a.ts'], writeFiles),
            { name: 'SyntaxError' },
          );
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      });
    }

    it('should reject when the writer cannot write metadata.json', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'metadata-writer-fails-'));
      try {
        const failure = new Error('disk full');

        await assert.rejects(
          () =>
            readWriteMetadata(dir, ['a.ts'], async () => {
              throw failure;
            }),
          failure,
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should reject an output path with a null byte', async () => {
      await assert.rejects(
        () =>
          readWriteMetadata(join(tmpdir(), 'file\0null'), ['a.ts'], writeFiles),
        { code: 'ERR_INVALID_ARG_VALUE' },
      );
    });

    it('should write metadata.json when none exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'metadata-new-'));
      try {
        await readWriteMetadata(dir, ['/a.ts'], writeFiles);

        assert.deepStrictEqual(
          JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf-8')),
          {
            generatedFiles: ['/a.ts'],
            userFiles: ['/dist/**', '/build/**', '/readme.md'],
          },
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('readWriteMetadata - Attack Phase: Corrupted Metadata States', () => {
    it('should handle missing generatedFiles array', async () => {
      const corruptedPath = join(testDir, 'corrupted-metadata.json');
      await writeFile(
        corruptedPath,
        JSON.stringify({
          userFiles: ['/dist/**'],
        }),
        'utf-8',
      );

      const result = await readWriteMetadata(
        testDir,
        ['file1.ts', 'file2.ts'],
        writeFiles,
      );

      assert.deepStrictEqual(result.generatedFiles, ['file1.ts', 'file2.ts']);
      // userFiles gets defaults added, so it should include the existing plus defaults
      assert.deepStrictEqual(result.userFiles, [
        '/dist/**',
        '/build/**',
        '/readme.md',
      ]);
    });

    it('should handle completely empty metadata file', async () => {
      const emptyMetadataDir = join(testDir, 'empty-metadata');
      await mkdir(emptyMetadataDir);

      const result = await readWriteMetadata(
        emptyMetadataDir,
        ['new-file.ts'],
        writeFiles,
      );

      assert.deepStrictEqual(result.generatedFiles, ['new-file.ts']);
      assert.deepStrictEqual(result.userFiles, [
        '/dist/**',
        '/build/**',
        '/readme.md',
      ]);
    });

    it('should overwrite generatedFiles but preserve existing userFiles', async () => {
      const preserveDir = join(testDir, 'preserve-test');
      await mkdir(preserveDir);

      // First write
      const result1 = await readWriteMetadata(
        preserveDir,
        ['old1.ts', 'old2.ts'],
        writeFiles,
      );
      // A user adds userFiles by editing metadata.json; no operation exposes it.
      await writeFile(
        join(preserveDir, 'metadata.json'),
        JSON.stringify({
          ...result1,
          userFiles: ['/custom/**', '/special.md'],
        }),
      );

      // Second write should preserve userFiles
      const result2 = await readWriteMetadata(
        preserveDir,
        ['new1.ts', 'new2.ts'],
        writeFiles,
      );

      assert.deepStrictEqual(result2.generatedFiles, ['new1.ts', 'new2.ts']);
      assert.deepStrictEqual(result2.userFiles, ['/custom/**', '/special.md']);
    });
  });

  describe('cleanFiles - Attack Phase: Race Conditions & File System Chaos', () => {
    it('should handle empty metadata gracefully', async () => {
      const emptyMetadata = {};
      const emptyDir = join(testDir, 'empty-clean');
      await mkdir(emptyDir);

      // Should not throw error
      await cleanFiles(emptyMetadata, emptyDir);
    });

    it('should handle undefined metadata fields', async () => {
      const undefinedMetadata = {
        generatedFiles: undefined,
        userFiles: undefined,
      };
      const undefinedDir = join(testDir, 'undefined-clean');
      await mkdir(undefinedDir);

      // Should not throw error and treat as empty arrays
      await cleanFiles(undefinedMetadata, undefinedDir);
    });

    it('should handle attempts to delete non-existent files (ENOENT)', async () => {
      const metadata = {
        generatedFiles: ['/src/existing.ts'],
        userFiles: ['/dist/**'],
      };

      const testCleanDir = join(testDir, 'clean-test');
      await mkdir(testCleanDir);
      await mkdir(join(testCleanDir, 'src'));

      // Create a file that matches a pattern that should be deleted
      await writeFile(join(testCleanDir, 'old-file.ts'), 'content');

      // File list includes non-existent file (simulates race condition)
      const alwaysAvailable = ['/src/**'];

      // Should not throw ENOENT error
      await cleanFiles(metadata, testCleanDir, alwaysAvailable);
    });

    it('should handle permission denied errors during deletion', async () => {
      const metadata = {
        generatedFiles: ['/protected/**'],
        userFiles: [],
      };

      const protectedDir = join(testDir, 'protected-clean');
      await mkdir(protectedDir);

      // Create a file that should be deleted
      await writeFile(join(protectedDir, 'deletable.ts'), 'content');

      // Should handle any permission errors gracefully
      await cleanFiles(metadata, protectedDir);
    });

    it('should deduplicate files to prevent double deletion attempts', async () => {
      const dedupeDir = join(testDir, 'dedupe-test');
      await mkdir(dedupeDir);

      // Create test files
      await writeFile(join(dedupeDir, 'duplicate1.ts'), 'content');
      await writeFile(join(dedupeDir, 'duplicate2.ts'), 'content');

      const metadata = {
        generatedFiles: [],
        userFiles: [],
      };

      // Should handle deduplication internally and not fail
      await cleanFiles(metadata, dedupeDir);
    });

    it('should handle extremely large file lists without memory issues', async () => {
      const largeListDir = join(testDir, 'large-list');
      await mkdir(largeListDir);

      // Create many files
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          writeFile(join(largeListDir, `file${i}.ts`), `content${i}`),
        );
      }
      await Promise.all(promises);

      const metadata = {
        generatedFiles: [],
        userFiles: [],
      };

      // Should handle large lists efficiently
      await cleanFiles(metadata, largeListDir);
    });
  });

  describe('cleanFiles - Invariant Testing: File Protection Rules', () => {
    it('should never delete files matching generatedFiles patterns', async () => {
      const protectionDir = join(testDir, 'protection-test');
      await mkdir(protectionDir, { recursive: true });
      await mkdir(join(protectionDir, 'src'), { recursive: true });

      // Create files that should be protected
      await writeFile(join(protectionDir, 'src', 'protected.ts'), 'protected');
      await writeFile(join(protectionDir, 'deletable.ts'), 'deletable');

      const metadata = {
        generatedFiles: ['/src/protected.ts'],
        userFiles: [],
      };

      await cleanFiles(metadata, protectionDir);

      // Protected file should still exist
      const protectedExists = await readFile(
        join(protectionDir, 'src', 'protected.ts'),
        'utf-8',
      );
      assert.strictEqual(protectedExists, 'protected');
    });

    it('should never delete files matching userFiles patterns', async () => {
      const userDir = join(testDir, 'user-protection');
      await mkdir(userDir, { recursive: true });
      await mkdir(join(userDir, 'dist'), { recursive: true });

      await writeFile(join(userDir, 'dist', 'user-file.js'), 'user content');
      await writeFile(join(userDir, 'temp.ts'), 'temp');

      const metadata = {
        generatedFiles: [],
        userFiles: ['/dist/**'],
      };

      await cleanFiles(metadata, userDir);

      // User file should be protected
      const userFileExists = await readFile(
        join(userDir, 'dist', 'user-file.js'),
        'utf-8',
      );
      assert.strictEqual(userFileExists, 'user content');
    });

    it('should never delete files matching alwaysAvailableFiles patterns', async () => {
      const alwaysDir = join(testDir, 'always-available');
      await mkdir(alwaysDir, { recursive: true });

      await writeFile(join(alwaysDir, 'package.json'), '{"name": "test"}');
      await writeFile(join(alwaysDir, 'temp.ts'), 'temp');

      const metadata = {
        generatedFiles: [],
        userFiles: [],
      };

      await cleanFiles(metadata, alwaysDir, ['/package.json']);

      // Always available file should be protected
      const packageExists = await readFile(
        join(alwaysDir, 'package.json'),
        'utf-8',
      );
      assert.strictEqual(packageExists, '{"name": "test"}');
    });
  });

  describe('cleanFiles - State Transition Testing: Before/After File States', () => {
    it('should properly transition from cluttered to clean directory state', async () => {
      const transitionDir = join(testDir, 'transition-test');
      await mkdir(transitionDir, { recursive: true });
      await mkdir(join(transitionDir, 'src'), { recursive: true });

      // Initial cluttered state
      await writeFile(join(transitionDir, 'old1.ts'), 'old');
      await writeFile(join(transitionDir, 'old2.ts'), 'old');
      await writeFile(join(transitionDir, 'src', 'keep.ts'), 'keep');
      await writeFile(join(transitionDir, 'package.json'), '{}');

      const metadata = {
        generatedFiles: ['/src/keep.ts'],
        userFiles: [],
      };

      await cleanFiles(metadata, transitionDir, ['/package.json']);

      // Verify final state: only protected files remain
      const keepExists = await readFile(
        join(transitionDir, 'src', 'keep.ts'),
        'utf-8',
      );
      assert.strictEqual(keepExists, 'keep');

      const packageExists = await readFile(
        join(transitionDir, 'package.json'),
        'utf-8',
      );
      assert.strictEqual(packageExists, '{}');

      // Old files should be gone
      await assert.rejects(() =>
        readFile(join(transitionDir, 'old1.ts'), 'utf-8'),
      );
      await assert.rejects(() =>
        readFile(join(transitionDir, 'old2.ts'), 'utf-8'),
      );
    });
  });

  describe('Combined Scenarios - Complex Real-World Edge Cases', () => {
    it('should handle metadata corruption + file system race conditions simultaneously', async () => {
      const chaosDir = join(testDir, 'chaos-test');
      await mkdir(chaosDir, { recursive: true });

      // Corrupted metadata with valid patterns only (empty strings break micromatch)
      const corruptedMetadata = {
        generatedFiles: [] as string[], // Empty array instead of null
        userFiles: ['/dist/**'], // Valid patterns only
      };

      await writeFile(join(chaosDir, 'survivor.ts'), 'should survive');

      // Should handle gracefully without crashing
      await cleanFiles(corruptedMetadata, chaosDir, ['/survivor.ts']);

      // File should survive due to alwaysAvailable pattern
      const survivorExists = await readFile(
        join(chaosDir, 'survivor.ts'),
        'utf-8',
      );
      assert.strictEqual(survivorExists, 'should survive');
    });
  });

  describe('Happy Path - Normal Operation Verification', () => {
    it('should successfully manage metadata lifecycle', async () => {
      const lifecycleDir = join(testDir, 'lifecycle');
      await mkdir(lifecycleDir);

      const result = await readWriteMetadata(
        lifecycleDir,
        ['app.ts', 'utils.ts'],
        writeFiles,
      );
      assert.deepStrictEqual(result.generatedFiles, ['app.ts', 'utils.ts']);
      assert.deepStrictEqual(result.userFiles, [
        '/dist/**',
        '/build/**',
        '/readme.md',
      ]);
    });

    it('should successfully clean files while preserving protected ones', async () => {
      const cleanDir = join(testDir, 'clean-happy');
      await mkdir(cleanDir, { recursive: true });
      await mkdir(join(cleanDir, 'src'), { recursive: true });

      await writeFile(join(cleanDir, 'src', 'index.ts'), 'main');
      await writeFile(join(cleanDir, 'old.ts'), 'delete me');
      await writeFile(join(cleanDir, 'package.json'), '{"version": "1.0.0"}');

      const metadata = {
        generatedFiles: ['/src/index.ts'],
        userFiles: [],
      };

      await cleanFiles(metadata, cleanDir, ['/package.json']);

      // Verify expected state
      const indexExists = await readFile(
        join(cleanDir, 'src', 'index.ts'),
        'utf-8',
      );
      assert.strictEqual(indexExists, 'main');

      const packageExists = await readFile(
        join(cleanDir, 'package.json'),
        'utf-8',
      );
      assert.strictEqual(packageExists, '{"version": "1.0.0"}');

      await assert.rejects(() => readFile(join(cleanDir, 'old.ts'), 'utf-8'));
    });
  });
});
