import { generateDocument } from '@sdk-it/openapi';

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
  const { document } = await generateDocument(config.openapi);
  await writeProjectClient(document, config);
}
