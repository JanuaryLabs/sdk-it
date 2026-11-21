# The backend owns how its document is produced, in a TypeScript module

Status: proposed (user, 2026-11-21: "Backend TS module")

## Context

The facts of a backend's document live in three places today. The analysis options sit in the CLI's `sdk-it.config.ts`. The base document and the operation tuning sit in 15 hand-written `openapi.ts` scripts. The derived-document spike put the backend tsconfig in the app's tsconfig.

A transformer is code, and a tsconfig is JSON.

## Decision

A backend default-exports `defineOpenApi({...})` from a module beside its tsconfig, by convention `openapi.ts`. Every consumer imports that module:

- the CLI's `defineConfig({ openapi })`
- the app's tsconfig (`"derived": { "src/backend.openapi": "../backend/openapi.ts" }`)
- any script

Paths in it are `URL`s built from `import.meta.url`, because each reader runs with a different cwd. The mapper process, for example, runs in its own package folder.

## Consequences

- One definition serves the CLI, the readers and scripts, so the document is the same in each.
- A reader loads code: `import()` of the definition. The definition module and what it imports are watched files too.
- The backend gets `@sdk-it/openapi` as a dev dependency.
