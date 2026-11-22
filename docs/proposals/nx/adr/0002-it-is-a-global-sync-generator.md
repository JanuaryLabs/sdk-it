# It is a global sync generator, so no task waits for an analysis

Status: proposed (#5158)

## Context

Nx 24 runs a target's `syncGenerators` before that target on every `nx run` (outside CI), and runs `sync.globalGenerators` only in `nx sync` and `nx sync:check` (`nx/dist/src/tasks-runner/run-command.js:461-465`, `command-line/sync/sync.js:16,26`). Deriving a document costs a backend analysis, 1-5 s. The readers already derive the document in memory, so no task needs the committed file to be fresh, only to exist.

## Decision

The workspace registers `@sdk-it/nx:derived-documents` in `sync.globalGenerators`, not in any target's `syncGenerators`.

## Consequences

- `nx run` never pays for an analysis.
- The document is fresh where it matters: at commit (the hook's `nx sync`) and in CI (`nx sync:check`).
- With the Nx daemon on, Nx also runs global generators in the background after each project-graph recompute (`daemon/server/sync-generators.js:97-117`). Whether that costs enough to need a memo (skip the analysis when no file it read changed) is measured after the first build, not assumed.
