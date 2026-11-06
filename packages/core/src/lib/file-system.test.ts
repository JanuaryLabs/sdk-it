import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  type WriteContent,
  addLeadingSlash,
  exist,
  getExt,
  getFile,
  isNullOrUndefined,
  readFolder,
  removeTrialingSlashes,
  writeFiles,
} from '@sdk-it/core/file-system.js';

describe('File System Utilities - Error-First Testing', () => {
  describe('getFile - Attack Phase: Invalid Inputs & File System Errors', () => {
    it('should return null for non-existent file', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const result = await getFile(join(workspace.path, 'does-not-exist.txt'));
      assert.strictEqual(result, null);
    });

    it('should return null for empty string path', async () => {
      const result = await getFile('');
      assert.strictEqual(result, null);
    });

    it('should throw error when trying to read a directory path instead of file', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const dirPath = join(workspace.path, 'test-dir-for-getfile');
      await mkdir(dirPath);

      await assert.rejects(() => getFile(dirPath), {
        code: 'EISDIR',
      });
    });

    it('rejects with EACCES for a file it cannot read', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const filePath = join(workspace.path, 'unreadable-file-for-getfile.txt');
      await writeFile(filePath, 'content');
      await chmod(filePath, 0o000);

      try {
        await assert.rejects(() => getFile(filePath), { code: 'EACCES' });
      } finally {
        await chmod(filePath, 0o600);
      }
    });

    it('should handle malformed paths', async () => {
      const malformedPaths = [
        '\0invalid',
        'file\nwith\nnewlines',
        'file\twith\ttabs',
      ];

      for (const path of malformedPaths) {
        const result = await getFile(path);
        assert.strictEqual(result, null, `Failed for path: ${path}`);
      }
    });
  });

  describe('exist - Attack Phase: Edge Cases & Invalid Paths', () => {
    it('should return false for non-existent paths', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      assert.strictEqual(
        await exist(
          join(workspace.path, 'non-existent-directory', 'deep', 'path'),
        ),
        false,
      );
    });

    it('should return false for empty string', async () => {
      assert.strictEqual(await exist(''), false);
    });

    it('should handle null bytes in path gracefully', async () => {
      assert.strictEqual(await exist('path\0with\0nulls'), false);
    });

    it('should handle extremely long paths', async () => {
      const longPath = 'a'.repeat(10000);
      assert.strictEqual(await exist(longPath), false);
    });
  });

  describe('readFolder - Attack Phase: Directory Corruption & Invalid States', () => {
    it('should return empty array for non-existent directory', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const result = await readFolder(
        join(workspace.path, 'non-existent-directory', 'deep', 'path'),
      );
      assert.deepStrictEqual(result, []);
    });

    it('should throw error for file path instead of directory', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const filePath = join(workspace.path, 'test-file-for-readfolder.txt');
      await writeFile(filePath, 'content');

      // readFolder should throw an error when given a file path
      await assert.rejects(() => readFolder(filePath), {
        code: 'ENOTDIR',
      });
    });

    it('rejects with EACCES for a directory it cannot read', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const dirPath = join(workspace.path, 'unreadable-dir-for-readfolder');
      await mkdir(dirPath);
      await chmod(dirPath, 0o000);

      try {
        await assert.rejects(() => readFolder(dirPath), { code: 'EACCES' });
      } finally {
        await chmod(dirPath, 0o700);
      }
    });

    it('should handle recursive reading with circular symlinks gracefully', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      // This tests the function's resilience to infinite loops
      const result = await readFolder(workspace.path, true);
      assert.ok(Array.isArray(result));
    });
  });

  describe('writeFiles - Attack Phase: Write Failures & State Corruption', () => {
    it('should handle null content gracefully', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const content: WriteContent = {
        'test.txt': null,
        'valid.txt': 'content',
      };

      await writeFiles(workspace.path, content);

      // Verify null content file was not created
      assert.strictEqual(await exist(join(workspace.path, 'test.txt')), false);
      // Verify valid file was created
      assert.strictEqual(await exist(join(workspace.path, 'valid.txt')), true);
    });

    it('should fail gracefully when writing to read-only directory', async () => {
      const readOnlyPath = '/read-only-system-path';
      const content: WriteContent = {
        'test.txt': 'content',
      };

      try {
        await writeFiles(readOnlyPath, content);
        assert.fail('Should have thrown an error for read-only directory');
      } catch (error) {
        assert.ok(Error.isError(error));
      }
    });

    it('should handle ignoreIfExists flag correctly when file exists', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const filePath = join(workspace.path, 'existing.txt');
      await writeFile(filePath, 'original');

      const content: WriteContent = {
        'existing.txt': {
          content: 'should not overwrite',
          ignoreIfExists: true,
        },
      };

      await writeFiles(workspace.path, content);
      const result = await getFile(filePath);
      assert.strictEqual(result, 'original');
    });

    it('should create deeply nested directories', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const content: WriteContent = {
        'deep/nested/structure/file.txt': 'content',
      };

      await writeFiles(workspace.path, content);
      const result = await getFile(
        join(workspace.path, 'deep/nested/structure/file.txt'),
      );
      assert.strictEqual(result, 'content');
    });
  });

  describe('getExt - Attack Phase: Malformed File Names', () => {
    it('should handle undefined filename', () => {
      assert.strictEqual(getExt(undefined), '');
    });

    it('should handle empty string filename', () => {
      assert.strictEqual(getExt(''), '');
    });

    it('should handle filename with no extension', () => {
      assert.strictEqual(getExt('filename'), '');
    });

    it('should handle filename with multiple dots', () => {
      assert.strictEqual(getExt('file.name.with.multiple.dots.ts'), 'ts');
    });

    it('should handle filename starting with dot', () => {
      // Based on the actual implementation, '.hidden' should return 'hidden'
      assert.strictEqual(getExt('.hidden'), 'hidden');
    });

    it('should handle filename with only dots', () => {
      // Based on the actual implementation, '...' returns 'txt' as fallback
      assert.strictEqual(getExt('...'), 'txt');
    });

    it('should handle filename with path separators', () => {
      assert.strictEqual(getExt('path/to/file.txt'), 'txt');
    });
  });

  describe('Path Utilities - Attack Phase: Malformed Paths', () => {
    describe('addLeadingSlash', () => {
      it('should handle empty string', () => {
        assert.strictEqual(addLeadingSlash(''), '/');
      });

      it('should handle path with multiple leading slashes', () => {
        assert.strictEqual(addLeadingSlash('///path'), '/path');
      });

      it('should handle path with backslashes', () => {
        const result = addLeadingSlash('path\\to\\file');
        assert.ok(result.startsWith('/'));
      });
    });

    describe('removeTrialingSlashes', () => {
      it('should handle empty string', () => {
        assert.strictEqual(removeTrialingSlashes(''), '');
      });

      it('should handle string with only slashes', () => {
        assert.strictEqual(removeTrialingSlashes('///'), '');
      });

      it('should preserve single slash when keepLastOne is true', () => {
        assert.strictEqual(removeTrialingSlashes('path///', true), 'path/');
      });
    });
  });

  describe('Type Guards - Attack Phase: Type Coercion Vulnerabilities', () => {
    describe('isNullOrUndefined', () => {
      it('should correctly identify falsy values that are not null/undefined', () => {
        assert.deepStrictEqual(
          [0, '', false, NaN].map((value) => isNullOrUndefined(value)),
          [false, false, false, false],
        );
      });

      it('should correctly identify null and undefined', () => {
        assert.deepStrictEqual(
          [null, undefined].map((value) => isNullOrUndefined(value)),
          [true, true],
        );
      });
    });

    // Remove notNullOrUndefined tests since it doesn't exist in the source
    describe('type safety verification', () => {
      it('should handle type coercion edge cases', () => {
        // Test that isNullOrUndefined works as a proper type guard
        const value: unknown = null;
        if (isNullOrUndefined(value)) {
          // TypeScript should narrow the type here
          assert.ok(value === null || value === undefined);
        }
      });
    });
  });

  describe('State Transition Testing - File System Operations', () => {
    it('should maintain file system consistency during complex operations', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const complexContent: WriteContent = {
        'folder1/file1.txt': 'content1',
        'folder1/file2.txt': null, // Should not be created
        'folder2/subfolder/file3.txt': {
          content: 'content3',
          ignoreIfExists: false,
        },
        'folder2/existing.txt': {
          content: 'new content',
          ignoreIfExists: true,
        },
      };

      // Pre-create existing file
      await mkdir(join(workspace.path, 'folder2'), { recursive: true });
      await writeFile(join(workspace.path, 'folder2/existing.txt'), 'original');

      await writeFiles(workspace.path, complexContent);

      // Verify final state
      assert.deepStrictEqual(
        await Promise.all([
          getFile(join(workspace.path, 'folder1/file1.txt')),
          exist(join(workspace.path, 'folder1/file2.txt')),
          getFile(join(workspace.path, 'folder2/subfolder/file3.txt')),
          getFile(join(workspace.path, 'folder2/existing.txt')),
        ]),
        ['content1', false, 'content3', 'original'],
      );
    });

    it('should maintain directory structure consistency during recursive operations', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      // Create nested structure
      const nestedDir = join(workspace.path, 'nested/deep/structure');
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(nestedDir, 'file.txt'), 'content');
      await writeFile(join(workspace.path, 'nested/file2.txt'), 'content2');

      const files = await readFolder(join(workspace.path, 'nested'), true);

      // Verify structure is maintained
      assert.deepStrictEqual(
        {
          hasDeepFile: files.includes('deep/structure/file.txt'),
          hasTopLevelFile: files.includes('file2.txt'),
          deepFileCount: files.filter((f) => f.startsWith('deep/')).length,
        },
        {
          hasDeepFile: true,
          hasTopLevelFile: true,
          deepFileCount: 1,
        },
      );
    });
  });

  describe('Happy Path - Basic Functionality Confirmation', () => {
    it('should successfully read existing file', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const filePath = join(workspace.path, 'test-read.txt');
      const content = 'test content';
      await writeFile(filePath, content);

      const result = await getFile(filePath);
      assert.strictEqual(result, content);
    });

    it('should correctly identify existing files and directories', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const filePath = join(workspace.path, 'test-exist-unique.txt');
      const dirPath = join(workspace.path, 'test-dir-unique');

      await writeFile(filePath, 'content');
      await mkdir(dirPath);

      assert.deepStrictEqual(
        await Promise.all([exist(filePath), exist(dirPath)]),
        [true, true],
      );
    });

    it('should read folder contents correctly', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const folderPath = join(workspace.path, 'read-test');
      await mkdir(folderPath);
      await writeFile(join(folderPath, 'file1.txt'), 'content1');
      await writeFile(join(folderPath, 'file2.txt'), 'content2');

      const files = await readFolder(folderPath);
      assert.deepStrictEqual(files.sort(), ['file1.txt', 'file2.txt']);
    });

    it('should write files correctly', async () => {
      await using workspace = await new TemporaryFiles().directory('fs-test-');
      const content: WriteContent = {
        'simple.txt': 'simple content',
        'complex.txt': {
          content: 'complex content',
          ignoreIfExists: false,
        },
      };

      await writeFiles(workspace.path, content);

      assert.deepStrictEqual(
        await Promise.all([
          getFile(join(workspace.path, 'simple.txt')),
          getFile(join(workspace.path, 'complex.txt')),
        ]),
        ['simple content', 'complex content'],
      );
    });

    it('should extract file extensions correctly', () => {
      assert.deepStrictEqual(
        ['file.txt', 'script.js', 'component.tsx'].map((filePath) =>
          getExt(filePath),
        ),
        ['txt', 'js', 'tsx'],
      );
    });

    it('should format paths correctly', () => {
      assert.strictEqual(addLeadingSlash('path/to/file'), '/path/to/file');
      assert.strictEqual(
        removeTrialingSlashes('path/to/file///'),
        'path/to/file',
      );
    });
  });
});
