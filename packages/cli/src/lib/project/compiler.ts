import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

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
  const source = join(output, 'src');
  const program = ts.createProgram({
    rootNames: ts.sys.readDirectory(source, ['.ts']),
    options: {
      allowSyntheticDefaultImports: true,
      declaration: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmitOnError: true,
      outDir: join(output, 'dist'),
      rewriteRelativeImportExtensions: true,
      rootDir: source,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: true,
    },
  });
  const result = program.emit();
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program),
    ...result.diagnostics,
  ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (result.emitSkipped || diagnostics.length > 0) {
    throw new Error(formatCompilationError(output, diagnostics));
  }

  await synchronizeGeneratedManifest(output, packageName);
}

function formatCompilationError(
  output: string,
  diagnostics: readonly ts.Diagnostic[],
): string {
  return `Failed to compile generated client:\n${ts.formatDiagnosticsWithColorAndContext(
    diagnostics,
    {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => output,
      getNewLine: () => '\n',
    },
  )}`;
}

async function synchronizeGeneratedManifest(
  output: string,
  packageName: string,
): Promise<void> {
  const manifestPath = join(output, 'package.json');
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as GeneratedPackageManifest;
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
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
