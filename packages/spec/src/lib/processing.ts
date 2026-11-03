import { untilAborted } from '@zukhruf/async';

import { finalizeOperations } from './finalize-operations.js';
import {
  type GenerateSdkConfig,
  coeraceConfig as coerceConfig,
} from './options.js';
import {
  createDefaultDocumentPlugins,
  createDefaultIRPlugins,
} from './processing-plugins/create-default-processing-plugins.js';
import type { IR, ProcessingDocument } from './types.js';

export type ProcessingDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ProcessingDiagnostic {
  plugin: string;
  severity: ProcessingDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
}

export type ProcessingOptions = Omit<ReturnType<typeof coerceConfig>, 'spec'>;

export interface ProcessingContext<Spec> {
  spec: Spec;
  options: ProcessingOptions;
  diagnostics: ProcessingDiagnostic[];
  signal?: AbortSignal;
  report(
    diagnostic: Omit<ProcessingDiagnostic, 'plugin'>,
  ): ProcessingDiagnostic;
}

/** A plugin that rewrites the raw OpenAPI document before its operations are finalized. */
export interface DocumentPlugin {
  name: string;
  process(context: ProcessingContext<ProcessingDocument>): void | Promise<void>;
}

/** A plugin that works on the IR, whose operations are already tuned. */
export interface IRPlugin {
  name: string;
  process(context: ProcessingContext<IR>): void | Promise<void>;
}

export interface ProcessDocumentConfig extends GenerateSdkConfig {
  plugins: readonly DocumentPlugin[];
}

export interface ProcessSpecConfig extends GenerateSdkConfig {
  documentPlugins?: readonly DocumentPlugin[];
  irPlugins?: readonly IRPlugin[];
}

export interface ProcessingResult<Spec> {
  spec: Spec;
  diagnostics: ProcessingDiagnostic[];
}

interface Run {
  options: ProcessingOptions;
  diagnostics: ProcessingDiagnostic[];
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: ProcessingDiagnostic) => void;
}

async function runPlugins<Spec>(
  spec: Spec,
  plugins: readonly {
    name: string;
    process(context: ProcessingContext<Spec>): void | Promise<void>;
  }[],
  { options, diagnostics, signal, onDiagnostic }: Run,
) {
  for (const plugin of plugins) {
    signal?.throwIfAborted();
    const context: ProcessingContext<Spec> = {
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
    await untilAborted(Promise.resolve(plugin.process(context)), signal);
    signal?.throwIfAborted();
  }
}

async function runDocumentStage(
  config: GenerateSdkConfig,
  plugins: readonly DocumentPlugin[],
) {
  const { signal, onDiagnostic } = config;
  signal?.throwIfAborted();
  const { spec, ...options } = coerceConfig({
    ...config,
    spec: structuredClone(config.spec),
  });
  const run: Run = { options, diagnostics: [], signal, onDiagnostic };
  await runPlugins(spec, plugins, run);
  const configuration = JSON.stringify({
    pagination: options.pagination,
    responses: options.responses,
  });
  return { spec, run, configuration };
}

/** Runs document-stage plugins only; the result's operations are still raw. */
export async function processDocument(
  config: ProcessDocumentConfig,
): Promise<ProcessingResult<ProcessingDocument>> {
  const { plugins, ...generateConfig } = config;
  const { spec, run, configuration } = await runDocumentStage(
    generateConfig,
    plugins,
  );
  spec['x-sdk-processing'] = {
    plugins: plugins.map((plugin) => plugin.name),
    configuration,
  };
  return { spec, diagnostics: run.diagnostics };
}

/**
 * Runs the document-stage plugins, finalizes the operations into the IR, then
 * runs the IR-stage plugins. Each omitted plugin list uses its defaults.
 */
export async function processSpec(
  config: ProcessSpecConfig,
): Promise<ProcessingResult<IR>> {
  const {
    documentPlugins = createDefaultDocumentPlugins(),
    irPlugins = createDefaultIRPlugins(),
    ...generateConfig
  } = config;
  const {
    spec: document,
    run,
    configuration,
  } = await runDocumentStage(generateConfig, documentPlugins);
  const spec = finalizeOperations(document);
  await runPlugins(spec, irPlugins, run);
  spec['x-sdk-processing'] = {
    plugins: [...documentPlugins, ...irPlugins].map((plugin) => plugin.name),
    configuration,
  };
  return { spec, diagnostics: run.diagnostics };
}
