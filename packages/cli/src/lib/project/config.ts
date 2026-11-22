import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { OpenApiDefinition } from '@sdk-it/openapi';
import { clientName } from '@sdk-it/typescript';

import { generatedPackageManifest } from './compiler.ts';

export interface ProjectConfig {
  /** How the backend's document is produced: the default export of its openapi.ts. */
  openapi: OpenApiDefinition;
  name: string;
  output?: string;
  packageName: string;
}

export interface ResolvedProjectConfig extends ProjectConfig {
  output: string;
}

export interface LoadProjectConfigOptions {
  cwd?: string;
  config?: string;
}

export interface InitializeProjectOptions {
  cwd?: string;
  tsconfig: string;
  name: string;
}

interface ProjectPackageManifest {
  name?: string;
  workspaces?: string[] | { packages?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

export function defineConfig<const Config extends ProjectConfig>(
  config: Config,
): Config {
  return config;
}

export async function loadProjectConfig(
  options: LoadProjectConfigOptions = {},
): Promise<ResolvedProjectConfig> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = options.config
    ? resolve(cwd, options.config)
    : await findProjectConfig(cwd);
  const loaded = await import(pathToFileURL(configPath).href);
  const config: ProjectConfig | undefined = loaded.default;
  if (!config) {
    throw new Error(
      `Expected ${configPath} to default export an SDK-IT config.`,
    );
  }
  if (typeof config.name !== 'string') {
    throw new Error(
      `Expected ${configPath} to set \`name\`, the name of the generated client (name: 'Books' exports createBooks).`,
    );
  }
  clientName(config.name);
  if (typeof config.packageName !== 'string') {
    throw new Error(
      `Expected ${configPath} to set \`packageName\`, the npm name of the generated client package (packageName: '@acme/books-client').`,
    );
  }
  if (!(config.openapi?.tsconfig instanceof URL)) {
    throw new Error(
      `Expected ${configPath} to set \`openapi\`, the backend's OpenAPI definition (the default export of its openapi.ts: defineOpenApi({ tsconfig: new URL('./tsconfig.json', import.meta.url), document })).`,
    );
  }

  return {
    ...config,
    output: resolve(dirname(configPath), config.output ?? '.sdk-it'),
  };
}

export async function initializeProject(
  options: InitializeProjectOptions,
): Promise<void> {
  clientName(options.name);
  const cwd = resolve(options.cwd ?? process.cwd());
  const tsconfigPath = resolve(cwd, options.tsconfig);
  await validateTsconfig(tsconfigPath);
  const projectDirectory = dirname(tsconfigPath);
  const configPath = join(projectDirectory, 'sdk-it.config.ts');
  const definitionPath = join(projectDirectory, 'openapi.ts');
  const { directory: workspaceDirectory, manifest } =
    await findWorkspace(projectDirectory);
  const packageName = generatedPackageName(
    manifest.name,
    projectDirectory,
    workspaceDirectory,
  );
  const tsconfig = relative(projectDirectory, tsconfigPath).replaceAll(
    '\\',
    '/',
  );
  const relativeTsconfig = tsconfig.startsWith('.')
    ? tsconfig
    : `./${tsconfig}`;
  const definitionSource = `import { defineOpenApi } from '@sdk-it/openapi';

export default defineOpenApi({
  tsconfig: new URL('${relativeTsconfig}', import.meta.url),
  document: {
    openapi: '3.1.0',
    info: { title: ${quoted(options.name)}, version: '1.0.0' },
  },
});
`;
  const configSource = `import { defineConfig } from '@sdk-it/cli';

import openapi from './openapi.ts';

export default defineConfig({
  openapi,
  name: ${quoted(options.name)},
  packageName: '${packageName}',
});
`;

  const existingDefinition = await readOptionalFile(definitionPath);
  if (
    existingDefinition !== undefined &&
    existingDefinition !== definitionSource
  ) {
    throw new Error(
      `${definitionPath} already exists with different settings. Review it before replacing the file.`,
    );
  }
  const existingConfig = await readOptionalFile(configPath);
  if (existingConfig !== undefined && existingConfig !== configSource) {
    throw new Error(
      `${configPath} already exists with different settings. Review it before replacing the file.`,
    );
  }

  const output = join(projectDirectory, '.sdk-it');
  const manifestPath = join(output, 'package.json');
  const existingManifest = await readOptionalFile(manifestPath);
  const parsedManifest: ProjectPackageManifest = existingManifest
    ? JSON.parse(existingManifest)
    : {};
  const generatedManifest = generatedPackageManifest(
    packageName,
    parsedManifest,
  );
  const generatedManifestSource = `${JSON.stringify(generatedManifest, null, 2)}\n`;
  const workspacePath = relative(workspaceDirectory, output).replaceAll(
    '\\',
    '/',
  );
  const manifestChanged = addGeneratedWorkspace(manifest, workspacePath);

  const gitignorePath = join(workspaceDirectory, '.gitignore');
  const gitignore = (await readOptionalFile(gitignorePath)) ?? '';
  const updatedGitignore = withGeneratedWorkspaceIgnore(
    gitignore,
    workspacePath,
  );
  if (updatedGitignore !== gitignore) {
    await writeFile(gitignorePath, updatedGitignore);
  }

  if (manifestChanged) {
    await writeFile(
      join(workspaceDirectory, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  if (existingDefinition === undefined) {
    await writeFile(definitionPath, definitionSource);
  }
  if (existingConfig === undefined) {
    await writeFile(configPath, configSource);
  }
  if (existingManifest !== generatedManifestSource) {
    await mkdir(output, { recursive: true });
    await writeFile(manifestPath, generatedManifestSource);
  }
}

function addGeneratedWorkspace(
  manifest: ProjectPackageManifest,
  workspace: string,
): boolean {
  const workspaces = manifest.workspaces;
  if (Array.isArray(workspaces)) {
    if (workspaces.includes(workspace)) return false;
    workspaces.push(workspace);
    return true;
  }
  if (workspaces && Array.isArray(workspaces.packages)) {
    if (workspaces.packages.includes(workspace)) return false;
    workspaces.packages.push(workspace);
    return true;
  }
  manifest.workspaces = [workspace];
  return true;
}

function withGeneratedWorkspaceIgnore(
  gitignore: string,
  workspace: string,
): string {
  const patterns = [
    `!${workspace}/`,
    `${workspace}/*`,
    `!${workspace}/package.json`,
  ];
  const lines = gitignore
    .split(/\r?\n/)
    .filter((line) => !patterns.includes(line.trim()));
  while (lines.at(-1) === '') lines.pop();
  return `${lines.length ? `${lines.join('\n')}\n` : ''}${patterns.join('\n')}\n`;
}

async function findWorkspace(
  start: string,
): Promise<{ directory: string; manifest: ProjectPackageManifest }> {
  let directory = start;
  let nearest:
    { directory: string; manifest: ProjectPackageManifest } | undefined;
  while (true) {
    const source = await readOptionalFile(join(directory, 'package.json'));
    if (source) {
      const manifest: ProjectPackageManifest = JSON.parse(source);
      const candidate = { directory, manifest };
      nearest ??= candidate;
      if (candidate.manifest.workspaces !== undefined) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (nearest) return nearest;
  throw new Error(`Could not find a package.json from ${start}.`);
}

function generatedPackageName(
  workspaceName: string | undefined,
  projectDirectory: string,
  workspaceDirectory: string,
): string {
  if (projectDirectory === workspaceDirectory) {
    if (workspaceName === undefined) {
      throw new Error(
        `Expected ${join(workspaceDirectory, 'package.json')} to set \`name\`: the client package is named after it (name '@acme/api' gives '@acme/api-client').`,
      );
    }
    return `${workspaceName}-client`;
  }
  const project = basename(projectDirectory)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  const scope = workspaceName?.match(/^@([^/]+)\//)?.[1];
  return scope ? `@${scope}/${project}-client` : `${project}-client`;
}

/** `value` as a single-quoted string literal. */
function quoted(value: string): string {
  return `'${JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'")}'`;
}

async function validateTsconfig(path: string): Promise<void> {
  try {
    if ((await stat(path)).isFile()) return;
  } catch (error) {
    if (!(Error.isError(error) && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
  throw new Error(`Could not find a TypeScript project at ${path}.`);
}

async function findProjectConfig(start: string): Promise<string> {
  let directory = start;
  while (true) {
    const candidate = join(directory, 'sdk-it.config.ts');
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) {
        throw new Error(
          `Could not find sdk-it.config.ts from ${start} or any parent directory.`,
        );
      }
      directory = parent;
    }
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (Error.isError(error) && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}
