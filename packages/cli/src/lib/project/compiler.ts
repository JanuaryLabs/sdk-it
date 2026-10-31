import {
  API,
  DiagnosticCategory,
  formatDiagnosticsWithColorAndContext,
} from '@typescript/native/sync';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { preEmitDiagnostics } from '@sdk-it/core/program.js';

interface GeneratedPackageManifest {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  types?: string;
  publishConfig?: Record<string, unknown>;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
}

export async function compileGeneratedPackage(
  output: string,
  packageName: string,
): Promise<void> {
  using api = new API();
  const config = api.parseJsonConfigFileContent(
    {
      compilerOptions: {
        declaration: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        noEmitOnError: true,
        outDir: 'dist',
        rewriteRelativeImportExtensions: true,
        rootDir: 'src',
        skipLibCheck: true,
        target: 'esnext',
        verbatimModuleSyntax: true,
      },
      include: ['src'],
    },
    { configDirectory: output },
  );
  using program = api.createProgram(config.fileNames, config.options);
  const result = program.emit();
  const diagnostics = [
    ...config.errors,
    ...preEmitDiagnostics(program),
    ...result.diagnostics,
  ].filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error);
  if (result.emitSkipped || diagnostics.length > 0) {
    throw new Error(
      `Failed to compile generated client:\n${formatDiagnosticsWithColorAndContext(diagnostics, program)}`,
    );
  }

  await synchronizeGeneratedManifest(output, packageName);
}

async function synchronizeGeneratedManifest(
  output: string,
  packageName: string,
): Promise<void> {
  const manifestPath = join(output, 'package.json');
  const manifest = generatedPackageManifest(
    packageName,
    JSON.parse(
      await readFile(manifestPath, 'utf8'),
    ) as GeneratedPackageManifest,
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function generatedPackageManifest(
  packageName: string,
  manifest: GeneratedPackageManifest,
): GeneratedPackageManifest {
  Object.assign(manifest, {
    name: packageName,
    version: '0.0.1',
    type: 'module',
    main: './dist/index.js',
    module: './dist/index.js',
    types: './dist/index.d.ts',
  });
  manifest.publishConfig = { ...manifest.publishConfig, access: 'public' };
  manifest.exports = {
    ...manifest.exports,
    './package.json': './package.json',
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    },
  };
  manifest.dependencies = {
    ...manifest.dependencies,
    'fast-content-type-parse': '^3.0.0',
    zod: '^4.3.0',
  };
  return manifest;
}
