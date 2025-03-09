import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

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
    string | { content: string; ignoreIfExists?: boolean }
  >,
) {
  return Promise.all(
    Object.entries(contents).map(async ([file, content]) => {
      const filePath = isAbsolute(file) ? file : join(dir, file);
      await mkdir(dirname(filePath), { recursive: true });
      if (typeof content === 'string') {
        await writeFile(filePath, content, 'utf-8');
      } else {
        if (content.ignoreIfExists) {
          if (!(await exist(filePath))) {
            await writeFile(filePath, content.content, 'utf-8');
          }
        }
      }
    }),
  );
}

export async function getFolderExports(folder: string, extensions = ['ts']) {
  const files = await readdir(folder, { withFileTypes: true });
  const exports: string[] = [];
  for (const file of files) {
    if (file.isDirectory()) {
      exports.push(`export * from './${file.name}/index.ts';`);
    } else if (
      file.name !== 'index.ts' &&
      extensions.includes(getExt(file.name))
    ) {
      exports.push(`export * from './${file.name}';`);
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
