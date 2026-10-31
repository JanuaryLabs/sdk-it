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

/** A program opened to read source. It never emits. */
export type AnalysisProgram = Omit<
  Program,
  'emit' | 'emitToString' | 'getJavaScriptEmit' | 'getDeclarationEmit'
>;

export interface AnalysisProject extends Disposable {
  readonly program: AnalysisProgram;
  readonly checker: Checker;
}

/**
 * Opens the project a tsconfig describes for static analysis. The project owns
 * a native TypeScript process: dispose it once analysis is done.
 */
export function openAnalysisProject(tsconfigPath: string): AnalysisProject {
  using stack = new DisposableStack();
  const api = stack.use(new API());
  const parsed = api.parseConfigFile(tsconfigPath);
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
  // Global diagnostics already carry the options diagnostics, and semantic
  // diagnostics the binder's, so neither is requested separately.
  return [
    ...program.getConfigFileParsingDiagnostics(),
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
