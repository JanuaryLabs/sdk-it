import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
} from 'node:path';

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

export async function readFolder(
  path: string,
  recursive = false,
): Promise<string[]> {
  if (!(await exist(path))) {
    return [];
  }
  const entries = await readdir(path, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (recursive) {
        const subFiles = await readFolder(join(path, entry.name), true);
        for (const sub of subFiles) {
          results.push(`${entry.name}/${sub}`);
        }
      }
    } else {
      results.push(entry.name);
    }
  }
  return results;
}

export type WriteContent = Record<
  string,
  null | string | { content: string; ignoreIfExists?: boolean }
>;

export type ReadFolderFn = (
  folder: string,
) => Promise<{ filePath: string; fileName: string; isFolder: boolean }[]>;
export type Writer = (dir: string, contents: WriteContent) => Promise<void>;

export async function writeFiles(dir: string, contents: WriteContent) {
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

/**
 * @deprecated use getFolderExportsV2 instead
 */
export async function getFolderExports(
  folder: string,
  readFolder: ReadFolderFn,
  includeExtension = true,
  extensions = ['ts'],
  ignore: (config: {
    filePath: string;
    fileName: string;
    isFolder: boolean;
  }) => boolean = () => false,
) {
  const files = await readFolder(folder);
  const exports: string[] = [];
  for (const file of files) {
    if (ignore(file)) {
      continue;
    }
    if (file.isFolder) {
      if (await exist(`${file.filePath}/index.ts`)) {
        exports.push(
          `export * from './${file.fileName}/index${includeExtension ? '.ts' : ''}';`,
        );
      }
    } else if (
      file.fileName !== 'index.ts' &&
      extensions.includes(getExt(file.fileName))
    ) {
      exports.push(
        `export * from './${includeExtension ? file.fileName : file.fileName.replace(extname(file.fileName), '')}';`,
      );
    }
  }
  return exports.join('\n');
}

export async function getFolderExportsV2(
  folder: string,
  readFolder: ReadFolderFn,
  options: {
    includeExtension?: boolean;
    extensions: string;
    ignore?: (fileInfo: {
      filePath: string;
      fileName: string;
      isFolder: boolean;
    }) => boolean;
    exportSyntax: string;
  } = {
    extensions: 'ts',
    ignore: () => false,
    includeExtension: true,
    exportSyntax: 'export * from ',
  },
) {
  options.includeExtension ??= true;
  if (!(await exist(folder))) {
    return '';
  }
  const files = await readFolder(folder);
  const exports: string[] = [];
  for (const file of files) {
    if (options.ignore?.(file)) {
      continue;
    }
    if (file.isFolder) {
      if (await exist(`${file.filePath}/index.${options.extensions}`)) {
        exports.push(
          `${options.exportSyntax} './${file.fileName}/index${
            options.includeExtension ? `.${options.extensions}` : ''
          }';`,
        );
      }
    } else if (
      file.fileName !== `index.${options.extensions}` &&
      options.extensions.includes(getExt(file.fileName))
    ) {
      exports.push(
        `${options.exportSyntax} './${options.includeExtension ? file.fileName : file.fileName.replace(extname(file.fileName), '')}';`,
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

export function addLeadingSlash(path: string) {
  return normalize(join('/', path));
}

export function removeTrialingSlashes(path: string, keepLastOne = false) {
  while (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path + (keepLastOne ? '/' : '');
}

export function isNullOrUndefined(value: any): value is undefined | null {
  return value === undefined || value === null;
}
export function notNullOrUndefined<T>(
  value: T,
): value is Exclude<T, null | undefined> {
  return !isNullOrUndefined(value);
}

export function createWriterProxy(
  writer: Writer,
  output: string,
): { writer: Writer; files: Set<string> } {
  const writtenFiles = new Set<string>();
  return {
    files: writtenFiles,
    writer: async (dir: string, contents: WriteContent) => {
      await writer(dir, contents);
      for (const file of Object.keys(contents)) {
        if (contents[file] !== null) {
          writtenFiles.add(addLeadingSlash(`${relative(output, dir)}/${file}`));
        }
      }
    },
  };
}
