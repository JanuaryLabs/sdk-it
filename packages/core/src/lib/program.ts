import type { CallExpression, Node, SourceFile } from '@typescript/native/ast';
import {
  isCallExpression as isCall,
  isIdentifier,
} from '@typescript/native/ast/is';
import {
  API,
  type Checker,
  type Diagnostic,
  type Program,
  formatDiagnosticsWithColorAndContext,
} from '@typescript/native/sync';
import { realpathSync } from 'node:fs';

/** A program opened to read source. It never emits. */
export type AnalysisProgram = Omit<
  Program,
  'emit' | 'emitToString' | 'getJavaScriptEmit' | 'getDeclarationEmit'
>;

export interface AnalysisProject extends Disposable {
  readonly program: AnalysisProgram;
  readonly checker: Checker;
}

function realTsconfigPath(tsconfigPath: string): string {
  try {
    return realpathSync(tsconfigPath);
  } catch (error) {
    // realpath names the first missing directory, not the file the caller passed.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `Failed to read ${tsconfigPath}: the file does not exist`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Opens the project a tsconfig describes for static analysis. The project owns
 * a native TypeScript process: dispose it once analysis is done. The program
 * names its files by real path, even when `tsconfigPath` goes through a symlink.
 */
export function openAnalysisProject(tsconfigPath: string): AnalysisProject {
  using stack = new DisposableStack();
  const api = stack.use(new API());
  // A referenced project maps to its source only when its path matches the
  // real path that module resolution reaches, so the config opens by real path.
  const parsed = api.parseConfigFile(realTsconfigPath(tsconfigPath));
  if (parsed.errors.length > 0) {
    throw new Error(
      `Failed to parse ${tsconfigPath}:\n${formatDiagnosticsWithColorAndContext(parsed.errors, api)}`,
    );
  }
  // Closing the API disposes every program it created.
  const program = api.createProgram(
    parsed.fileNames,
    {
      ...parsed.options,
      // Packages may expose their implementation for static analysis while
      // keeping ordinary consumers on declarations and compiled JavaScript.
      customConditions: [
        '@sdk-it/source',
        ...(parsed.options.customConditions ?? []),
      ],
      noEmit: true,
    },
    { projectReferences: parsed.projectReferences },
  );
  const owned = stack.move();
  return {
    program,
    checker: program.getProject().checker,
    [Symbol.dispose]: () => owned.dispose(),
  };
}

/** The diagnostics a compile reports before it emits. */
export function preEmitDiagnostics(
  program: AnalysisProgram,
): readonly Diagnostic[] {
  // Global diagnostics already carry the config file and options diagnostics,
  // and semantic diagnostics the binder's, so none is requested separately.
  return [
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...(program.getCompilerOptions().declaration
      ? program.getDeclarationDiagnostics()
      : []),
  ];
}

/** The program's source files, declaration files excluded. */
export function* sourceFiles(program: AnalysisProgram): Generator<SourceFile> {
  for (const fileName of program.getSourceFileNames()) {
    const sourceFile = program.getSourceFile(fileName);
    if (sourceFile && !sourceFile.isDeclarationFile) {
      yield sourceFile;
    }
  }
}

export function isCallExpression(
  node: Node,
  name: string,
): node is CallExpression {
  return (
    isCall(node) &&
    isIdentifier(node.expression) &&
    node.expression.text === name
  );
}
