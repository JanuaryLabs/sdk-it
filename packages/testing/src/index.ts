import {
  API,
  formatDiagnosticsWithColorAndContext,
} from '@typescript/native/sync';

import { preEmitDiagnostics } from '@sdk-it/core/program.js';

/** A tsconfig.json path, or tsconfig content whose relative paths start at `directory`. */
export type Project = string | { tsconfig: object; directory: string };

export interface TypeDiagnostic {
  file: string | undefined;
  line: number | undefined;
  message: string;
}

export interface Typecheck {
  /** Every file the program read, declaration files included. */
  files: readonly string[];
  diagnostics: TypeDiagnostic[];
}

/**
 * Type-checks a project the way its consumers compile it: unlike
 * `openAnalysisProject`, no `@sdk-it/source` condition, so workspace packages
 * resolve to their declarations.
 */
export function typecheck(project: Project): Typecheck {
  using api = new API();
  const parsed =
    typeof project === 'string'
      ? api.parseConfigFile(project)
      : api.parseJsonConfigFileContent(project.tsconfig, {
          configDirectory: project.directory,
        });
  if (parsed.errors.length > 0) {
    throw new Error(
      `Failed to parse the tsconfig:\n${formatDiagnosticsWithColorAndContext(parsed.errors, api)}`,
    );
  }
  using program = api.createProgram(parsed.fileNames, parsed.options);
  return {
    files: program.getSourceFileNames(),
    diagnostics: preEmitDiagnostics(program).map((diagnostic) => ({
      file: diagnostic.fileName,
      line: diagnostic.startPosition && diagnostic.startPosition.line + 1,
      message: diagnostic.text,
    })),
  };
}
