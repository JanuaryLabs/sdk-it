import deubg from 'debug';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import pLimit from 'p-limit';

import {
  addLeadingSlash,
  exist,
  readFolder,
} from '@sdk-it/core/file-system.js';

const log = deubg('sdk-it:metdata');

export async function readWriteJson<T = Record<string, unknown>>(path: string) {
  const content = (
    (await exist(path)) ? JSON.parse(await readFile(path, 'utf-8')) : {}
  ) as Partial<T>;
  return {
    content,
    write: (value: Record<string, unknown> = content) =>
      writeFile(path, JSON.stringify(value, null, 2), 'utf-8'),
  };
}

interface Metadata {
  generatedFiles: string[];
  userFiles?: string[];
}

export async function readWriteMetadata(output: string, files: string[]) {
  const metadata = await readWriteJson<Metadata>(join(output, 'metadata.json'));
  metadata.content.generatedFiles = files;
  metadata.content.userFiles ??= ['/dist/**', '/build/**', '/readme.md'];
  await metadata.write(metadata.content);
  return metadata;
}

/**
 * Must run this file before writing the index files
 * otherwise the index.ts file will have have references to files
 * that are deleted (old, non used generated files)
 * @param metadata
 * @param output
 */
export async function cleanFiles(
  metadata: Partial<Metadata>,
  output: string,
  alwaysAvailableFiles: string[] = [],
) {
  const { default: micromatch } = await import('micromatch');
  const generated = metadata.generatedFiles ?? [];
  const user = metadata.userFiles ?? [];
  const keep = [...generated, ...user, ...alwaysAvailableFiles];
  const actualFiles = (await readFolder(output, true)).map(addLeadingSlash);
  const filesToDelete = [
    ...new Set(
      actualFiles.filter(
        (file) =>
          !micromatch.isMatch(file, keep, { cwd: join(process.cwd(), output) }),
      ),
    ),
  ];
  const limit = pLimit(availableParallelism());

  await Promise.all(
    filesToDelete.map((file) =>
      limit(async () => {
        const filePath = join(output, file);
        try {
          await unlink(filePath);
          log(`Deleted file: ${filePath}`);
        } catch (error: unknown) {
          // Ignore ENOENT errors - file was already deleted or doesn't exist
          if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            log(`File already deleted or doesn't exist: ${filePath}`);
          } else {
            throw error;
          }
        }
      }),
    ),
  );

  // for (const file of actualFiles) {
  //   if (micromatch.isMatch(addLeadingSlash(file), keep)) {
  //     continue;
  //   }
  //   const filePath = join(output, file);
  //   await unlink(filePath);
  //   log(`Deleted file: ${filePath}`);
  // }
}
