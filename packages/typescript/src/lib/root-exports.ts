import runtime, { type DeclaredBinding } from 'runtime-module';

/** The runtime files whose exports the SDK root re-exports: the response classes, ParseError and parseInput. */
export const rootRuntimeFiles = ['http/response.ts', 'http/parser.ts'];

/** The runtime declarations the SDK root re-exports. */
export const runtimeRootExports = runtime.bindings.filter(
  (binding): binding is DeclaredBinding =>
    binding.kind === 'declared' &&
    binding.exported &&
    rootRuntimeFiles.includes(binding.file),
);
