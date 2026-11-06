import { isErrno } from '@zukhruf/fs';
import { readFile, unlink } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { debuglog } from 'node:util';
import pLimit from 'p-limit';

import {
  type Writer,
  addLeadingSlash,
  readFolder,
} from '@sdk-it/core/file-system.js';

const log = debuglog('sdk-it:metadata');

interface Metadata {
  generatedFiles: string[];
  userFiles: string[];
}

export async function readWriteMetadata(
  output: string,
  files: string[],
  writer: Writer,
): Promise<Metadata> {
  const previous = await readMetadata(join(output, 'metadata.json'));
  const metadata: Metadata = {
    ...previous,
    generatedFiles: files,
    userFiles: previous.userFiles ?? ['/dist/**', '/build/**', '/readme.md'],
  };
  await writer(output, {
    'metadata.json': JSON.stringify(metadata, null, 2),
  });
  return metadata;
}

async function readMetadata(path: string): Promise<Partial<Metadata>> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return {};
    throw error;
  }
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
          if (isErrno(error, 'ENOENT')) {
            log(`File already deleted or doesn't exist: ${filePath}`);
          } else {
            throw error;
          }
        }
      }),
    ),
  );
}
