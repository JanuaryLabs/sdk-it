import { npmRunPathEnv } from 'npm-run-path';

import { type ReadFolderFn, type Writer } from '@sdk-it/core/file-system.js';
import type { PaginationConfig } from '@sdk-it/spec';

import type { Style } from './style.ts';

export interface TypeScriptGeneratorOptions {
  agentTools?: 'ai-sdk' | 'openai-agents';
  readme?: boolean | string;
  style?: Style;
  output: string;
  useTsExtension?: boolean;
  name?: string;
  pagination?: PaginationConfig | false;
  writer?: Writer;
  readFolder?: ReadFolderFn;
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
