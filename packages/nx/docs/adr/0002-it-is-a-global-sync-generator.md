# It is a global sync generator, so no task waits for an analysis

Status: accepted (user, 2026-11-22, #5158)

## Context

Nx 24 runs a target's `syncGenerators` before that target on every `nx run` (outside CI), and runs `sync.globalGenerators` only in `nx sync` and `nx sync:check` (`nx/dist/src/tasks-runner/run-command.js:461-465`, `command-line/sync/sync.js:16,26`). Deriving a document costs a backend analysis: meddit's (19 paths, 120 source files) takes 0.56-0.76 s per `generateDocument`, about 2 s in a fresh process (measured 2026-11-22). Before tasks, outside CI, Nx runs each task's `syncGenerators`, and without a TTY (an agent shell, a GUI git client) an out-of-sync result prints "The workspace is out of sync" and stops the tasks (`run-command.js:459-500`). A derived document goes stale on every backend route edit, so a per-target registration would stop every non-interactive `nx run` after such an edit until someone runs `nx sync`. The readers already derive the document in memory, so no task needs the committed file to be fresh, only to exist.

## Decision

The workspace registers `@sdk-it/nx:openapi-sync` in `sync.globalGenerators`, not in any target's `syncGenerators`.

## Consequences

- `nx run` never pays for an analysis, and never stops because a document is stale.
- The document is fresh where it matters: at commit (the hook's `nx sync`) and in CI (`nx sync:check`).
- With the Nx daemon on, Nx also runs global generators in the background after each project-graph recompute (`daemon/server/sync-generators.js:69-117`, registered at `daemon/server/server.js:477`). Every save runs one: in a one-route workspace, 85-94 ms per save after a first run of 253 ms, with the daemon's memory flat (214 to 227 MB over three saves; measured 2026-11-22 on Nx 24.0.3). On meddit's backend that is one 0.56-0.76 s analysis per save. The run writes nothing (the daemon keeps its changes in memory until `nx sync` asks for them) and blocks no command. The commit hook (`NX_DAEMON=false`) and CI (no daemon) always derive afresh. So the generator keeps no memo. A memo keyed by the files an analysis read would miss a change outside them, such as a dependency in `node_modules`, and answer "fresh" for a stale document.
