import { resolve } from 'node:path';

import { analyzeProject } from './project/analysis.ts';
import type { ProjectConfig } from './project/config.ts';
import { writeProjectClient } from './project/output.ts';

export {
  defineConfig,
  initializeProject,
  loadProjectConfig,
} from './project/config.ts';
export type {
  InitializeProjectOptions,
  LoadProjectConfigOptions,
  ProjectConfig,
  ResolvedProjectConfig,
} from './project/config.ts';

export async function generateProject(config: ProjectConfig): Promise<void> {
  const tsconfig = resolve(config.tsconfig);
  const openapi = await analyzeProject(tsconfig, config);
  await writeProjectClient(openapi, config);
}
