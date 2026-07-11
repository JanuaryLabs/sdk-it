import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ProjectConfig {
  tsconfig: string;
  framework?: 'auto' | 'hono';
  preset?: 'auto' | 'prisma' | 'none';
  output?: string;
  packageName?: string;
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
  };
}

export async function initializeProject(
  options: InitializeProjectOptions,
): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = join(cwd, 'sdk-it.config.ts');
  const tsconfigPath = resolve(cwd, options.tsconfig);
  await validateTsconfig(tsconfigPath);
  const tsconfig = relative(cwd, tsconfigPath).replaceAll('\\', '/');
  const relativeTsconfig = tsconfig.startsWith('.')
    ? tsconfig
    : `./${tsconfig}`;
  const configSource = `import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: '${relativeTsconfig}',
});
`;

  const existingConfig = await readOptionalFile(configPath);
  if (existingConfig !== undefined && existingConfig !== configSource) {
    throw new Error(
      `${configPath} already exists with different settings. Review it before replacing the file.`,
    );
  }

  const packagePath = join(cwd, 'package.json');
  const manifest = JSON.parse(
    await readFile(packagePath, 'utf8'),
  ) as ProjectPackageManifest;
  const manifestChanged = addGeneratedWorkspace(manifest);

  const gitignorePath = join(cwd, '.gitignore');
  const gitignore = (await readOptionalFile(gitignorePath)) ?? '';
  if (!ignoresGeneratedWorkspace(gitignore)) {
    const prefix =
      gitignore.length > 0 && !gitignore.endsWith('\n') ? '\n' : '';
    await writeFile(gitignorePath, `${gitignore}${prefix}.sdk-it/\n`);
  }

  if (manifestChanged) {
    await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (existingConfig === undefined) {
    await writeFile(configPath, configSource);
  }
}

function addGeneratedWorkspace(manifest: ProjectPackageManifest): boolean {
  const workspaces = manifest.workspaces;
  if (Array.isArray(workspaces)) {
    if (workspaces.includes('.sdk-it')) return false;
    workspaces.push('.sdk-it');
    return true;
  }
  if (workspaces && Array.isArray(workspaces.packages)) {
    if (workspaces.packages.includes('.sdk-it')) return false;
    workspaces.packages.push('.sdk-it');
    return true;
  }
  manifest.workspaces = ['.sdk-it'];
  return true;
}

function ignoresGeneratedWorkspace(gitignore: string): boolean {
  return gitignore
    .split(/\r?\n/)
    .some((line) => line.trim() === '.sdk-it/' || line.trim() === '.sdk-it');
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
