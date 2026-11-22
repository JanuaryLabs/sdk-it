# @sdk-it/nx glossary

- **Derived document**: an OpenAPI document that an app imports and a tsconfig declares derived from a backend's definition module (`contentMappers[].options.derived`). Committed, so TypeScript can resolve the import.
- **Definition module**: the backend's `openapi.ts`, whose default export is `defineOpenApi(...)` from `@sdk-it/openapi`.
- **Reader**: anything that renders a derived document's client: the content mapper in `tsc` and the editor, `sdkIt.imports()` in Vite, `@sdk-it/content-mapper/register` in Node. A reader derives the document in memory and writes nothing.
- **Writer**: what writes the committed file. Only the `openapi-sync` sync generator.
- **Stale**: the committed bytes differ from what the backend derives now.
- **Sync generator**: an Nx generator that `nx sync` runs to keep committed files in step with the workspace, and `nx sync:check` runs to report when they are not.
