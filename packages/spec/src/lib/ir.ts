import { createDefaultIRPlugins } from './processing-plugins/create-default-processing-plugins.js';
import { type ProcessSpecConfig, processSpec } from './processing.js';
import type { IR } from './types.js';

export async function toIR(
  config: ProcessSpecConfig,
  verbose = false,
): Promise<IR> {
  const result = await processSpec({
    ...config,
    irPlugins: config.irPlugins ?? createDefaultIRPlugins({ verbose }),
  });
  return result.spec;
}
