import { npmRunPathEnv } from 'npm-run-path';

import { type Writer } from '@sdk-it/core/file-system.js';
import type { PaginationConfig } from '@sdk-it/spec';

export interface TypeScriptGeneratorOptions {
  agentTools?: 'ai-sdk' | 'openai-agents';
  readme?: boolean | string;
  output: string;
  useTsExtension?: boolean;
  name: string;
  /** The npm name of the generated package: package.json's name, and the name the README installs and imports. */
  packageName: string;
  pagination?: PaginationConfig | false;
  writer?: Writer;
  /**
   * full: generate a full project including package.json and tsconfig.json. useful for monorepo/workspaces
   * minimal: generate only the client sdk
   */
  mode?: 'full' | 'minimal';
  formatCode?: (options: {
    output: string;
    env: ReturnType<typeof npmRunPathEnv>;
  }) => void | Promise<void>;
  /**
   * Whether to remove files that were previously generated but no longer needed
   * @default true
   */
  cleanup?: boolean;
}
