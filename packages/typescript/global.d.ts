declare module '*.txt' {
  const content: string;
  export default content;
}

/** @sdk-it/runtime's source files by path, e.g. 'http/request.ts'; inlined at build time by esbuild.config.mjs. */
declare module 'runtime-sources' {
  const sources: Record<string, string>;
  export default sources;
}
