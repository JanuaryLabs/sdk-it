import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { generate } from '@sdk-it/typescript';

import { hashProject, isCurrentGeneratedPackage } from './cache.ts';
import { compileGeneratedPackage } from './compiler.ts';
import type { ProjectConfig } from './config.ts';

type ProjectOpenApi = Parameters<typeof generate>[0];

export async function writeProjectClient(
  openapi: ProjectOpenApi,
  config: ProjectConfig,
): Promise<void> {
  const output = resolve(config.output ?? '.sdk-it');
  const packageName = config.packageName ?? '@sdk-it/client';
  const hash = hashProject(openapi, packageName);
  if (await isCurrentGeneratedPackage(output, hash)) return;

  await generate(openapi, {
    output,
    mode: 'full',
    name: 'Client',
    packageName,
    readme: false,
  });
  await compileGeneratedPackage(output, packageName);
  await writeFile(join(output, '.project-hash'), hash);
}
