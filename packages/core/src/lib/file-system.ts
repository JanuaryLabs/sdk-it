import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join } from 'node:path';

export async function getFile(filePath: string) {
  if (await exist(filePath)) {
    return readFile(filePath, 'utf-8');
  }
  return null;
}

export async function exist(file: string): Promise<boolean> {
  return stat(file)
    .then(() => true)
    .catch(() => false);
}

export async function readFolder(path: string) {
  if (await exist(path)) {
    return readdir(path);
  }
  return [] as string[];
}

export async function writeFiles(
  dir: string,
  contents: Record<
    string,
    null | string | { content: string; ignoreIfExists?: boolean }
  >,
) {
  await Promise.all(
    Object.entries(contents).map(async ([file, content]) => {
      if (content === null) {
        return;
      }
      const filePath = isAbsolute(file) ? file : join(dir, file);
      await mkdir(dirname(filePath), { recursive: true });
      if (typeof content === 'string') {
        await writeFile(filePath, content, 'utf-8');
      } else {
        if (content.ignoreIfExists) {
          if (!(await exist(filePath))) {
            await writeFile(filePath, content.content, 'utf-8');
          }
        } else {
          await writeFile(filePath, content.content, 'utf-8');
        }
      }
    }),
  );
}

export async function getFolderExports(
  folder: string,
  includeExtension = true,
  extensions = ['ts'],
  ignore: (dirent: Dirent) => boolean = () => false,
) {
  const files = await readdir(folder, { withFileTypes: true });
  const exports: string[] = [];
  for (const file of files) {
    if (ignore(file)) {
      continue;
    }
    if (file.isDirectory()) {
      exports.push(
        `export * from './${file.name}/index${includeExtension ? '.ts' : ''}';`,
      );
    } else if (
      file.name !== 'index.ts' &&
      extensions.includes(getExt(file.name))
    ) {
      exports.push(
        `export * from './${includeExtension ? file.name : file.name.replace(extname(file.name), '')}';`,
      );
    }
  }
  return exports.join('\n');
}

export const getExt = (fileName?: string) => {
  if (!fileName) {
    return ''; // shouldn't happen as there will always be a file name
  }
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  const ext = fileName
    .slice(lastDot + 1)
    .split('/')
    .filter(Boolean)
    .join('');
  if (ext === fileName) {
    // files that have no extension
    return '';
  }
  return ext || 'txt';
};
