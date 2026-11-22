import { isErrno } from '@zukhruf/fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { isRecord } from './is-record.js';

/** An Nx project as its project.json and package.json declare it. */
interface NxProject {
  readonly root: string;
  /** The name Nx gives it: project.json's, else the package's `nx.name`, else the package's. */
  readonly name: string | undefined;
  readonly packageName: string | undefined;
  readonly implicitDependencies: readonly string[];
  /** The packages its package.json depends on, of every dependency kind. */
  readonly packages: ReadonlySet<string>;
}

/** Whether an app's project has an Nx edge to its backend's, and the files that tell. */
export interface NxEdge {
  /** The backend's project name, when the app's project has no edge to it. */
  readonly missing: string | undefined;
  /** The project.json and package.json files read. */
  readonly read: readonly string[];
}

const NONE: NxEdge = { missing: undefined, read: [] };

/**
 * Whether the Nx project of `appDirectory` has an edge to the project that
 * holds `definition`. Nx caches a target and computes `nx affected` from the
 * project graph, which has an edge for an import, a package dependency or an
 * `implicitDependencies` entry; a derived document reads the backend through
 * none of the app's imports. Outside an Nx workspace, or when both are one
 * project, no edge is needed. An entry with a glob character may name the
 * backend by Nx's matching, which this does not repeat, so it counts as an
 * edge: a missed warning costs less than a wrong error.
 */
export async function nxEdge(
  appDirectory: string,
  definition: string,
): Promise<NxEdge> {
  const workspace = await nxWorkspaceOf(appDirectory);
  if (!workspace || !within(workspace, definition)) {
    return NONE;
  }
  const read: string[] = [];
  const app = await projectOf(appDirectory, workspace, read);
  const backend = await projectOf(dirname(definition), workspace, read);
  if (!app || !backend?.name || app.root === backend.root) {
    return { missing: undefined, read };
  }
  const { name, packageName } = backend;
  const named = app.implicitDependencies.some(
    (entry) => entry === name || /[*?[{]/.test(entry),
  );
  const depends = packageName !== undefined && app.packages.has(packageName);
  return { missing: named || depends ? undefined : name, read };
}

async function nxWorkspaceOf(directory: string): Promise<string | undefined> {
  for (let current = directory; ; current = dirname(current)) {
    if ((await readJson(join(current, 'nx.json'))) !== undefined) {
      return current;
    }
    if (dirname(current) === current) {
      return undefined;
    }
  }
}

function within(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset !== '..' && !offset.startsWith(`..${sep}`);
}

/** The project whose root is `directory` or its nearest parent, up to `workspace`, that holds a project.json or package.json. */
async function projectOf(
  directory: string,
  workspace: string,
  read: string[],
): Promise<NxProject | undefined> {
  for (
    let current = directory;
    within(workspace, current);
    current = dirname(current)
  ) {
    const projectPath = join(current, 'project.json');
    const packagePath = join(current, 'package.json');
    const project = await readJson(projectPath);
    const manifest = await readJson(packagePath);
    if (project === undefined && manifest === undefined) {
      if (current === workspace) {
        return undefined;
      }
      continue;
    }
    read.push(
      ...(project === undefined ? [] : [projectPath]),
      ...(manifest === undefined ? [] : [packagePath]),
    );
    const nx = recordAt(manifest, 'nx');
    return {
      root: current,
      name:
        text(project?.['name']) ??
        text(nx?.['name']) ??
        text(manifest?.['name']),
      packageName: text(manifest?.['name']),
      implicitDependencies: [
        ...texts(project?.['implicitDependencies']),
        ...texts(nx?.['implicitDependencies']),
      ],
      packages: new Set(
        [
          'dependencies',
          'devDependencies',
          'peerDependencies',
          'optionalDependencies',
        ].flatMap((kind) => Object.keys(recordAt(manifest, kind) ?? {})),
      ),
    };
  }
  return undefined;
}

async function readJson(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
  return isRecord(value) ? value : {};
}

function recordAt(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const entry = value?.[key];
  return isRecord(entry) ? entry : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
