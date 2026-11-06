import { extname } from 'node:path';

import { rootRuntimeFiles } from './root-exports.ts';

interface Entry {
  name: string;
  isFolder: boolean;
}

interface IndexedFolder {
  folder: string;
  ignore?: (entry: Entry) => boolean;
}

const folders: IndexedFolder[] = [
  { folder: 'outputs' },
  {
    folder: 'inputs',
    ignore: (entry) => entry.isFolder && entry.name === 'schemas',
  },
  { folder: 'api' },
  {
    folder: 'http',
    ignore: (entry) => !rootRuntimeFiles.includes(`http/${entry.name}`),
  },
  { folder: 'models' },
];

// Agent tool groups are named after tags, so they stay out of the root, where
// a group could share a name with the client's default instance.
const root: IndexedFolder = {
  folder: '',
  ignore: (entry) => entry.name === 'agents.ts',
};

/**
 * The index.ts files of an SDK whose source files are `paths` (relative to the
 * SDK source root). `contentOf` gives the content of an index.ts the SDK does
 * not generate, such as one a user added to a subfolder.
 */
export function indexFiles(
  paths: Iterable<string>,
  contentOf: (path: string) => string | undefined,
  useTsExtension: boolean,
): Record<string, string> {
  const listed = [...paths];
  const indexes: Record<string, string> = {};
  const content = (path: string) =>
    path in indexes ? indexes[path] : contentOf(path);
  for (const folder of folders) {
    indexes[`${folder.folder}/index.ts`] = folderExports(
      listed,
      folder,
      content,
      useTsExtension,
    );
  }
  if (indexes['inputs/index.ts'] === '') delete indexes['inputs/index.ts'];
  indexes['index.ts'] = folderExports(listed, root, content, useTsExtension);
  return indexes;
}

function folderExports(
  paths: string[],
  { folder, ignore }: IndexedFolder,
  contentOf: (path: string) => string | undefined,
  useTsExtension: boolean,
) {
  const prefix = folder ? `${folder}/` : '';
  const entries = new Map<string, Entry>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const [name, ...rest] = path.slice(prefix.length).split('/');
    entries.set(name, { name, isFolder: rest.length > 0 });
  }
  const exports: string[] = [];
  for (const entry of [...entries.values()].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (ignore?.(entry)) continue;
    if (entry.isFolder) {
      if (contentOf(`${prefix}${entry.name}/index.ts`)) {
        exports.push(
          `export * from './${entry.name}/index${useTsExtension ? '.ts' : ''}';`,
        );
      }
    } else if (entry.name !== 'index.ts' && extname(entry.name) === '.ts') {
      exports.push(
        `export * from './${useTsExtension ? entry.name : entry.name.slice(0, -'.ts'.length)}';`,
      );
    }
  }
  return exports.join('\n');
}
