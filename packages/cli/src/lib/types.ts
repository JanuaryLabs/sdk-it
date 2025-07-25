import type { PaginationConfig } from '@sdk-it/spec';

/**
 * Base interface for all generator options
 */
export interface BaseGeneratorOptions {
  spec: string;
  output: string;
  mode?: 'full' | 'minimal';
  name: string;
  verbose?: boolean;
}

/**
 * TypeScript generator options
 */
export interface TypeScriptOptions extends BaseGeneratorOptions {
  useTsExtension?: boolean;
  formatter?: string;
  framework?: string;
  install?: boolean;
  defaultFormatter?: boolean;
  outputType?: 'default' | 'status';
  errorAsValue?: false;
  readme?: boolean;
  publish?: string;
  pagination?: PaginationConfig | false;
}

/**
 * Python generator options
 */
export interface PythonOptions extends BaseGeneratorOptions {
  formatter?: string;
}

/**
 * Dart generator options
 */
export interface DartOptions extends BaseGeneratorOptions {
  formatter?: string;
  pagination?: PaginationConfig | false;
}

/**
 * Complete SDK configuration file structure
 */
export interface SdkConfig {
  readme?: {
    spec: string;
    output: string;
  };
  apiref?: {
    spec: string;
    output: string;
  };
  generators: {
    typescript?: TypeScriptOptions;
    python?: PythonOptions;
    dart?: DartOptions;
  };
}
