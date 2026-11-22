# Every reader derives the document itself, and the app commits it

Status: accepted (spikes and user decisions of 2026-11-21, #5158); amended 2026-11-22: readers no longer write the document, [`@sdk-it/nx` ADR 0001](../../../nx/docs/adr/0001-the-sync-generator-is-the-only-writer-of-a-derived-document.md)

## Context

An app in the same repo as its backend imports the backend's client through the content mapper with no generation step. TypeScript 7.1 refuses a mapper extension that ends in a built-in one (TS18066, tested with `.api.ts`), so the import names a real non-TS file: the OpenAPI document.

Every reader (the content mapper in tsc and in the editor, `sdkIt.imports()`, the Node register hook) starts on its own. A separate writer that has to run first would be a step.

## Decision

The app's tsconfig names the definition (`contentMappers[].options.derived`). Each reader calls `generateDocument`, renders the client from the result and watches `sourceFiles`. It writes nothing: the committed document's only writer is `@sdk-it/nx`'s `openapi-sync` sync generator (`nx sync`, the commit hook, `nx sync:check` in CI). While readers rewrote it (until 2026-11-22), every typecheck or dev server in a shared checkout left a diff that nobody owned, and a commit could leave it stale (meddit b66f673). Vite and Node find the declaration by walking up from the document to the tsconfig that names it.

The mapper declares `dynamicConfig`: `openProject` returns the source files as `watchedFiles` and a hash of the documents as `configIdentity`. In an Nx workspace, it reports an option diagnostic (`sdk-it5`) when the app's project has no edge to the backend's project. That edge keeps the app's cached targets and `nx affected` current. The app imports none of the backend's code, so the edge is an `implicitDependencies` entry. A dependency on the backend's package is an edge too, but it makes `@nx/dependency-checks` demand the backend's packages in a bundled app (meddit, 2026-11-22).

## Consequences

Measured in the spikes:

- tsc --watch re-types about 4 ms after a backend save.
- The editor stalls about 0.6 s per backend save for meddit, while TypeScript holds requests during `openProject`. The user accepted this.
- Analyses are byte-deterministic, so the bytes the writer commits are the bytes every reader derives.
- The document is reviewed as an API diff in each PR.

Measured while building it (2026-11-22): TypeScript 7.1 resolves the import before the content mapper's `openProject` runs, so a document that does not exist on disk is TS2307 for `tsc` and the editor; the mapper cannot create it in time. The committed document is therefore required, not only a convenience: a fresh checkout has it, and `nx sync` rewrites it from the backend. The readers do not need it fresh, only present, so a separate writer is no step before them.
