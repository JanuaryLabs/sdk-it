import type { OpenAPIObject } from 'openapi3-ts/oas31';

import {
  type GenerateSdkConfig,
  coeraceConfig as coerceConfig,
} from './options.js';
import type { IR } from './types.js';

export type ProcessingDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ProcessingDiagnostic {
  plugin: string;
  severity: ProcessingDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
}

export type ProcessingOptions = Omit<ReturnType<typeof coerceConfig>, 'spec'>;

export interface ProcessingContext {
  spec: IR;
  options: ProcessingOptions;
  diagnostics: ProcessingDiagnostic[];
  signal?: AbortSignal;
  report(
    diagnostic: Omit<ProcessingDiagnostic, 'plugin'>,
  ): ProcessingDiagnostic;
}

export interface ProcessingPlugin {
  name: string;
  process(context: ProcessingContext): void | Promise<void>;
}

export interface ProcessSpecConfig extends GenerateSdkConfig {
  plugins: readonly ProcessingPlugin[];
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: ProcessingDiagnostic) => void;
}

export interface ProcessingResult {
  spec: IR;
  diagnostics: ProcessingDiagnostic[];
}

export async function processSpec(
  config: ProcessSpecConfig,
): Promise<ProcessingResult> {
  const { plugins, signal, onDiagnostic, ...generateConfig } = config;
  signal?.throwIfAborted();
  const coerced = coerceConfig({
    ...generateConfig,
    spec: structuredClone(generateConfig.spec) as OpenAPIObject,
  });
  const { spec, ...options } = coerced;
  const diagnostics: ProcessingDiagnostic[] = [];
  const pluginNames = plugins.map((plugin) => plugin.name);
  const configuration = JSON.stringify({
    pagination: options.pagination,
    responses: options.responses,
  });

  for (const plugin of plugins) {
    signal?.throwIfAborted();
    const context: ProcessingContext = {
      spec,
      options,
      diagnostics,
      signal,
      report(diagnostic) {
        const reported = { ...diagnostic, plugin: plugin.name };
        diagnostics.push(reported);
        onDiagnostic?.(reported);
        return reported;
      },
    };
    await plugin.process(context);
    signal?.throwIfAborted();
  }

  spec['x-sdk-processing'] = { plugins: pluginNames, configuration };

  return { spec, diagnostics };
}
