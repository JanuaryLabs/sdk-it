import {
  API,
  formatDiagnosticsWithColorAndContext,
} from '@typescript/native/sync';
import { type TemporaryDirectory, TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preEmitDiagnostics } from '@sdk-it/core/program.js';

// Both src/ and dist/ of this package sit three folders below the repository root.
const workspaces = fileURLToPath(
  new URL('../../../.test-workspaces/', import.meta.url),
);

/**
 * A temporary directory below the repository's gitignored `.test-workspaces/`.
 * Node and TypeScript resolve a package from the parent folders of the
 * importing file, so a file in it imports the repository's packages (zod, hono,
 * `@sdk-it/*`) from the root `node_modules`, as in the user's own app.
 */
export async function workspaceDirectory(
  prefix: string,
): Promise<TemporaryDirectory> {
  await mkdir(workspaces, { recursive: true });
  return new TemporaryFiles().directory(prefix, { parent: workspaces });
}

export interface AnalysisWorkspace extends TemporaryDirectory {
  /** The app's tsconfig.json, for `openAnalysisProject`. */
  tsconfig: string;
}

/**
 * A TypeScript app in a workspace directory: an ES module `package.json`, a
 * bundler `tsconfig.json` that includes each `.ts` file of `files` (strict, as
 * TypeScript 7 is without a `strict` key), and `files` (paths relative to the
 * app, folders created).
 */
export async function analysisWorkspace(
  prefix: string,
  files: Record<string, string>,
  compilerOptions: Record<string, unknown> = {},
): Promise<AnalysisWorkspace> {
  await using pending = new AsyncDisposableStack();
  const directory = pending.use(await workspaceDirectory(prefix));
  const tsconfig = join(directory.path, 'tsconfig.json');
  await writeFile(join(directory.path, 'package.json'), '{"type":"module"}');
  await writeFile(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        noEmit: true,
        skipLibCheck: true,
        ...compilerOptions,
      },
      include: Object.keys(files).filter((name) => name.endsWith('.ts')),
    }),
  );
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory.path, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  pending.move();
  return { ...directory, tsconfig };
}

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

/**
 * For a CLI run inside the test process: marks stdin as a terminal, so the CLI
 * does not wait for piped input, and on dispose restores stdin and the
 * `process.exitCode` that the CLI sets. `t.mock.property` cannot do this:
 * `isTTY` is absent on a stdin that is not a terminal.
 */
export function ttyStdin(): Disposable {
  const isTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const exitCode = process.exitCode;
  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  });
  return {
    [Symbol.dispose]() {
      process.exitCode = exitCode;
      if (isTTY) {
        Object.defineProperty(process.stdin, 'isTTY', isTTY);
      } else {
        Reflect.deleteProperty(process.stdin, 'isTTY');
      }
    },
  };
}

/**
 * An `assert.rejects` matcher: the generated client refused the input with a
 * `ParseError` whose only field error is `field`.
 */
export function parseErrorFor(field: string) {
  return (error: { name: string; data: { fieldErrors: object } }) => {
    assert.equal(error.name, 'ParseError');
    assert.deepEqual(Object.keys(error.data.fieldErrors), [field]);
    return true;
  };
}
