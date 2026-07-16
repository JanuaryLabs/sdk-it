import type { GenerateSdkConfig } from './options.js';
import { createDefaultProcessingPlugins } from './processing-plugins/index.js';
import { processSpec } from './processing.js';
import type { IR } from './types.js';

export async function toIR(
  config: GenerateSdkConfig,
  verbose = false,
): Promise<IR> {
  const plugins = config.plugins ?? createDefaultProcessingPlugins({ verbose });
  const result = await processSpec({ ...config, plugins });
  return result.spec;
}
