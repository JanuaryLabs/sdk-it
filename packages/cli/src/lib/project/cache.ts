import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import ts from 'typescript';

import type { generate } from '@sdk-it/typescript';

const require = createRequire(import.meta.url);
const projectGeneratorVersions = {
  cli: require('@sdk-it/cli/package.json').version,
  compiler: ts.version,
  typescript: require('@sdk-it/typescript/package.json').version,
};

type ProjectOpenApi = Parameters<typeof generate>[0];

export function hashProject(
  openapi: ProjectOpenApi,
  packageName: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ openapi, packageName, projectGeneratorVersions }))
    .digest('hex');
}

export async function isCurrentGeneratedPackage(
  output: string,
  hash: string,
): Promise<boolean> {
  return (
    (await readOptionalFile(join(output, '.project-hash'))) === hash &&
    (await generatedPackageExists(output))
  );
}

async function generatedPackageExists(output: string): Promise<boolean> {
  try {
    const sourceRoot = join(output, 'src');
    const sources = await findSourceFiles(sourceRoot);
    if (!sources.includes(join(sourceRoot, 'index.ts'))) return false;

    await Promise.all([
      access(join(output, 'package.json')),
      ...sources.flatMap((source) =>
        expectedCompiledFiles(output, sourceRoot, source).map((file) =>
          access(file),
        ),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

function expectedCompiledFiles(
  output: string,
  sourceRoot: string,
  source: string,
): string[] {
  const compiled = relative(sourceRoot, source).slice(0, -3);
  return [
    join(output, 'dist', `${compiled}.js`),
    join(output, 'dist', `${compiled}.d.ts`),
  ];
}

async function findSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return findSourceFiles(path);
      return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.d.ts')
        ? [path]
        : [];
    }),
  );
  return files.flat();
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
