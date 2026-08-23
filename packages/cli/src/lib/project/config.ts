import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { OpenAPISecuritySchemeObject } from '@sdk-it/core';
import type { MiddlewareSecurityRule } from '@sdk-it/generic';

import { generatedPackageManifest } from './compiler.ts';

export interface ProjectConfig {
  tsconfig: string;
  framework?: 'auto' | 'hono';
  preset?: 'auto' | 'prisma' | 'none';
  output?: string;
  packageName?: string;
  securitySchemes?: Record<string, OpenAPISecuritySchemeObject>;
  middlewareSecurity?: readonly MiddlewareSecurityRule[];
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
  const config = loaded.default as ProjectConfig | undefined;
  if (!config || typeof config.tsconfig !== 'string') {
    throw new Error(
      `Expected ${configPath} to default export an SDK-IT config with a tsconfig path.`,
    );
  }

  const directory = dirname(configPath);
  return {
    ...config,
    tsconfig: resolve(directory, config.tsconfig),
    output: resolve(directory, config.output ?? '.sdk-it'),
    ...(config.middlewareSecurity
      ? {
          middlewareSecurity: config.middlewareSecurity.map((rule) => ({
            ...rule,
            middleware: {
              ...rule.middleware,
              from: resolve(directory, rule.middleware.from),
            },
          })),
        }
      : {}),
  };
}

export async function initializeProject(
  options: InitializeProjectOptions,
): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const tsconfigPath = resolve(cwd, options.tsconfig);
  await validateTsconfig(tsconfigPath);
  const projectDirectory = dirname(tsconfigPath);
  const configPath = join(projectDirectory, 'sdk-it.config.ts');
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
  const configSource = `import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: '${relativeTsconfig}',
${projectDirectory === workspaceDirectory ? '' : `  packageName: '${packageName}',\n`}});
`;

  const existingConfig = await readOptionalFile(configPath);
  if (existingConfig !== undefined && existingConfig !== configSource) {
    throw new Error(
      `${configPath} already exists with different settings. Review it before replacing the file.`,
    );
  }

  const output = join(projectDirectory, '.sdk-it');
  const manifestPath = join(output, 'package.json');
  const existingManifest = await readOptionalFile(manifestPath);
  const generatedManifest = generatedPackageManifest(
    packageName,
    existingManifest
      ? (JSON.parse(existingManifest) as ProjectPackageManifest)
      : {},
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
      const candidate = {
        directory,
        manifest: JSON.parse(source) as ProjectPackageManifest,
      };
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
  if (projectDirectory === workspaceDirectory) return '@sdk-it/client';
  const project = basename(projectDirectory)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  const scope = workspaceName?.match(/^@([^/]+)\//)?.[1];
  return scope ? `@${scope}/${project}-client` : `${project}-client`;
}

async function validateTsconfig(path: string): Promise<void> {
  try {
    if ((await stat(path)).isFile()) return;
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
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
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}
