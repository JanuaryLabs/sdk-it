declare module '*.txt' {
  const content: string;
  export default content;
}

/** @sdk-it/runtime's source files by path, e.g. 'http/request.ts'; inlined at build time by esbuild.config.mjs. */
declare module 'runtime-sources' {
  const sources: Record<string, string>;
  export default sources;
}

/** @sdk-it/runtime joined into one module (runtime-module.mjs); inlined at build time by esbuild.config.mjs. Offsets index `text`. */
declare module 'runtime-module' {
  interface Uses {
    occurrences: number[];
    /** Shorthand properties (`{ name }`), which keep their key when the binding is renamed. */
    shorthands: number[];
  }
  /** A runtime declaration, from `file` (e.g. 'http/response.ts'). */
  export interface DeclaredBinding extends Uses {
    kind: 'declared';
    name: string;
    file: string;
    exported: boolean;
    /** An interface or type alias. */
    type: boolean;
  }
  /** A name the runtime imports from a package. */
  interface ExternalBinding extends Uses {
    kind: 'external';
    name: string;
    module: string;
  }
  export type RuntimeBinding = DeclaredBinding | ExternalBinding;
  export interface RuntimeModule {
    text: string;
    bindings: RuntimeBinding[];
    globals: { name: string; occurrences: number[] }[];
  }
  const runtime: RuntimeModule;
  export default runtime;
}
