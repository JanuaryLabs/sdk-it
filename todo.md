# Backend-to-client generation TODO

## Scope

Build the config-driven backend-to-client workflow documented in `docs/recipes/backend-to-client.md`.

The public API belongs to `@sdk-it/cli`:

```ts
import { defineConfig, generateProject } from '@sdk-it/cli';
```

The implementation must use vertical TDD slices. For each behavior: add one failing integration test, record the RED result, add the minimum implementation, record the GREEN result, and then refactor while tests remain green.

## Out of scope

- Watch mode and file watchers.
- Publishing generated clients to a registry.
- Python or Dart generation from a backend project.
- Additional backend frameworks beyond Hono.

## Status key

- `[ ]` Not started.
- `[~]` In progress.
- `[x]` Complete and recorded in `progress.md`.

Only one item may be in progress at a time. Update `progress.md` immediately after marking an item complete.

## Ordered work

- [x] **T00 — Lock the scope and public interface**
  - Keep `defineConfig` and `generateProject` in `@sdk-it/cli`.
  - Keep Vite as an optional driver over the shared CLI package API.
  - Exclude watch mode.

- [x] **T01 — Align the documentation with the approved CLI ownership**
  - Use `@sdk-it/cli` as the programmatic API.
  - Remove the watch command, watcher behavior, and watch acceptance scenario.
  - Preserve the shared-engine ownership model.
  - Verify Markdown formatting and links.

- [x] **T02 — Import `@sdk-it/cli` without starting the executable**
  - RED: integration test imports the package and observes no Commander parsing or process exit.
  - GREEN: separate the library entry from the executable entry.
  - Preserve the existing CLI executable behavior.
  - Export `defineConfig` and `generateProject` from the package root.

- [x] **T03 — Generate a client from a Hono TypeScript project**
  - RED: integration test calls `generateProject({ tsconfig })` against a real Hono fixture.
  - Assert a known route appears in the generated client package.
  - GREEN: detect Hono, analyze the project, build OpenAPI in memory, and call the TypeScript generator.
  - Use `.sdk-it` and `@sdk-it/client` defaults.

- [x] **T04 — Produce a package Node.js can execute directly**
  - RED: integration test imports the generated client with Node.js and no TypeScript loader.
  - GREEN: emit JavaScript and matching declaration files under `.sdk-it/dist`.
  - Point runtime exports to JavaScript and type exports to declarations.
  - Do not place raw TypeScript under `node_modules`.

- [x] **T05 — Load `sdk-it.config.ts` through the shared API**
  - RED: integration test loads a typed config containing only `tsconfig`.
  - GREEN: add `defineConfig` and config discovery relative to the workspace.
  - Resolve relative project and output paths from the config file's directory.
  - Support an explicit config path.

- [x] **T06 — Generate through the CLI command**
  - RED: integration test runs the executable's `generate` command in a fixture workspace.
  - GREEN: load the config and delegate to `generateProject`.
  - Ensure the CLI and programmatic API produce the same package.
  - Keep existing OpenAPI generator commands working.

- [x] **T07 — Detect the Prisma preset automatically**
  - RED: integration test uses Prisma-derived types without supplying Prisma paths.
  - GREEN: detect Prisma from resolved TypeScript imports and declarations.
  - Support the standard Prisma client location and a custom generated-client location.
  - Report the selected framework and preset.

- [x] **T08 — Honor `preset: 'none'`**
  - RED: integration test proves Prisma configuration is skipped when disabled.
  - GREEN: bypass preset detection while preserving analyzer defaults.

- [x] **T09 — Honor `preset: 'prisma'`**
  - RED: integration test forces Prisma and expects a direct error when its generated client cannot be resolved.
  - GREEN: apply the preset or return an actionable failure naming the unresolved project.

- [x] **T10 — Generate through Vite without owning the pipeline**
  - RED: integration test calls `sdkIt()` during a Vite build and compares its output with CLI generation.
  - GREEN: load `sdk-it.config.ts` and delegate to the `@sdk-it/cli` project API.
  - Preserve current string, OpenAPI object, and callback plugin inputs.
  - Do not add file watching.

- [x] **T11 — Initialize `.sdk-it` repository settings safely**
  - RED: integration test runs initialization in a fixture with existing `.gitignore` and workspace configuration.
  - GREEN: add `.sdk-it/`, workspace registration, and `sdk-it.config.ts` without duplicating entries.
  - Ask before replacing conflicting configuration in the interactive path.
  - Make repeated initialization idempotent.

- [x] **T12 — Avoid rewriting an unchanged generated package**
  - RED: integration test generates twice and observes unchanged output metadata on the second run.
  - GREEN: skip writes when the analyzed OpenAPI document and generation settings are unchanged.

- [x] **T13 — Finish documentation and package metadata**
  - Document installation, initialization, programmatic generation, CLI generation, Vite integration, Prisma overrides, fresh clones, and CI.
  - Update package exports, dependencies, Nx references, and release metadata.

- [x] **T14 — Run final verification**
  - Run `nx run <project>:test` for every affected package.
  - Run `nx run <project>:typecheck` for every affected package.
  - Run formatting and `git diff --check`.
  - Review the final diff for generated files and unrelated changes.
  - Record exact commands and results in `progress.md`.

- [x] **T15 — Consolidate documentation and complete code review**
  - Remove the obsolete design document and its README link.
  - Make the recipe the single source of truth and correct command examples.
  - Update `todo.md` and `progress.md`.
  - Run a dedicated code-review agent over the complete worktree.
  - Address confirmed findings and rerun affected verification.

- [x] **T16 — Fix final audit edge cases**
  - Remove the unused public OpenAPI-output option.
  - Require cache hits to have a complete generated runtime package.
  - Validate repository metadata before initialization writes any file.
  - Detect aliased and separately imported Prisma namespaces.
  - Add regression coverage and rerun affected verification.

- [x] **T17 — Fix clean verification regressions**
  - Narrow every supported Vite overload without rejecting legacy string inputs.
  - Compile Vite integration tests separately from the published library output.
  - Keep the `preset: 'none'` integration scenario independent of disabled Prisma runtime injection.
  - Rerun affected tests and type checks sequentially.

- [x] **T18 — Address final review findings**
  - Synchronize generated manifest metadata when generation settings change.
  - Treat every missing nested JavaScript or declaration artifact as an invalid cache hit.
  - Include the TypeScript compiler version in cache identity and document the supported peer range.
  - Reject a missing backend tsconfig before initialization writes repository files.
  - Preserve named Prisma import semantics during analyzer evaluation.
  - Add regression coverage and rerun all affected tests and type checks.

## Per-item completion checklist

Before completing any TDD item:

- [ ] The test exercises a public interface.
- [ ] The test name describes observable behavior.
- [ ] Expected values come from a fixed example, not implementation logic.
- [ ] The RED failure proves the behavior is missing.
- [ ] The GREEN result passes through the intended real code path.
- [ ] Any refactor occurred only after GREEN.
- [ ] Relevant focused tests and type checks pass.
- [ ] `progress.md` contains the result and verification evidence.
