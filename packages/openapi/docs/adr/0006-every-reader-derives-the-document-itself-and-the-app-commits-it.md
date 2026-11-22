# Every reader derives the document itself, and the app commits it

Status: accepted (spikes and user decisions of 2026-11-21, #5158)

## Context

An app in the same repo as its backend imports the backend's client through the content mapper with no generation step. TypeScript 7.1 refuses a mapper extension that ends in a built-in one (TS18066, tested with `.api.ts`), so the import names a real non-TS file: the OpenAPI document.

Every reader (the content mapper in tsc and in the editor, `sdkIt.imports()`, the Node register hook) starts on its own. A separate writer that has to run first would be a step.

## Decision

The app's tsconfig names the definition (`contentMappers[].options.derived`). Each reader calls `generateDocument`, renders the client from the result, watches `sourceFiles`, and rewrites the committed document when its bytes differ, through a temp file and a rename. Vite and Node find the declaration by walking up from the document to the tsconfig that names it.

The mapper declares `dynamicConfig`: `openProject` returns the source files as `watchedFiles` and a hash of the documents as `configIdentity`. In an Nx workspace, it reports an option diagnostic (`sdk-it5`) when the app's project has no edge to the backend's project. That edge keeps the app's cached targets and `nx affected` current. The app imports none of the backend's code, so the edge is an `implicitDependencies` entry. A dependency on the backend's package is an edge too, but it makes `@nx/dependency-checks` demand the backend's packages in a bundled app (meddit, 2026-11-22).

## Consequences

Measured in the spikes:

- tsc --watch re-types about 4 ms after a backend save.
- The editor stalls about 0.6 s per backend save for meddit, while TypeScript holds requests during `openProject`. The user accepted this.
- Analyses are byte-deterministic, so readers writing at once write the same bytes.
- The document is reviewed as an API diff in each PR.

Measured while building it (2026-11-22): TypeScript 7.1 resolves the import before the content mapper's `openProject` runs, so a document that does not exist on disk is TS2307 for `tsc` and the editor; the mapper cannot create it in time. The committed document is therefore required, not only a convenience: a fresh checkout has it, and any reader rewrites it from the backend.
