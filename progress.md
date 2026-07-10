# Backend-to-client generation progress

This file records completed items from `todo.md`. Add an entry immediately after each item finishes. Include the behavior delivered, files changed, RED and GREEN evidence for TDD items, verification commands, and any decision that affects later work.

## Current status

- Current item: None — all implementation and review work complete
- Completed: 19 of 19 items
- Blockers: None
- Explicitly excluded: Watch mode and file watchers

## Completed items

### 2026-07-09 — T00: Lock the scope and public interface

Status: Complete

Decisions:

- `@sdk-it/cli` will export `defineConfig` and `generateProject`.
- The package's library import must not start Commander or parse process arguments.
- The CLI executable, programmatic API, and Vite plugin will call one shared generation pipeline.
- Vite will remain optional and will not own analysis or generation.
- `.sdk-it` will hold the generated client package.
- Watch mode is outside this implementation scope.

Evidence:

- The user approved moving the project API into `@sdk-it/cli` instead of adding a package.
- The TDD order and behavioral scope are recorded in `todo.md`.

Verification:

- Planning only; no implementation test applies to this item.

### 2026-07-09 — T01: Align the documentation with the approved CLI ownership

Status: Complete

Delivered:

- `sdk-it.config.ts` now imports `defineConfig` from `@sdk-it/cli`.
- The documentation assigns generation to the shared project API inside the CLI package.
- The Vite plugin remains an optional driver.
- Watch commands, watcher behavior, and watch acceptance criteria were removed.

Files:

- `docs/recipes/backend-to-client.md`

Verification:

- Command: `npx prettier --check README.md docs/recipes/backend-to-client.md todo.md progress.md`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- The documentation keeps the internal term "project generator" for the shared pipeline, but it does not introduce a new package.

### 2026-07-09 — T02: Import `@sdk-it/cli` without starting the executable

Status: Complete

Delivered:

- Importing `@sdk-it/cli` no longer starts Commander or reads `sdk-it.json`.
- The package root exports `defineConfig` and `generateProject`.
- The command-line executable now uses a separate `dist/bin.js` entry.
- The existing hidden `_internal` command still exits successfully through the executable.

Files:

- `packages/cli/src/index.ts`
- `packages/cli/src/bin.ts`
- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`
- `packages/cli/package.json`
- `packages/cli/project.json`
- `packages/cli/tsconfig.json`
- `packages/cli/tsconfig.test.json`

RED:

- Command: `nx run @sdk-it/cli:test`
- Result: failed because importing `@sdk-it/cli` ran the default command and attempted to open a missing `sdk-it.json`.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 1 test; the public import returned both functions without CLI output or side effects.

Additional verification:

- Command: `node packages/cli/dist/bin.js _internal`
- Result: passed with exit code 0.
- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- The package root is the side-effect-free library entry.
- `dist/bin.js` is the executable entry declared by the package's `bin` field.

### 2026-07-09 — T03: Generate a client from a Hono TypeScript project

Status: Complete

Delivered:

- `generateProject({ tsconfig })` analyzes a real Hono TypeScript project.
- The project API detects Hono from resolved project source imports.
- It builds an OpenAPI 3.1 document in memory and passes it to the TypeScript generator.
- It defaults to `.sdk-it`, `@sdk-it/client`, and the `Client` class.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/tsconfig.lib.json`

RED:

- Command: `nx run @sdk-it/cli:test`
- Result: the Hono integration test failed with `Project generation is not implemented yet.`

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 2 tests; the generated `books.ts` endpoint contains the fixed `"GET /books"` route.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- Framework auto-detection uses the backend TypeScript program, not the frontend or Vite configuration.
- The first supported framework is Hono; unsupported detection returns an actionable override message.

### 2026-07-09 — T04: Produce a package Node.js can execute directly

Status: Complete

Delivered:

- Project generation compiles client source into `.sdk-it/dist`.
- The generated package exports `dist/index.js` for runtime imports.
- It exports `dist/index.d.ts` for TypeScript consumers.
- Node.js imports `@sdk-it/client` without a TypeScript loader.
- Generated TypeScript remains outside `node_modules`; the package manager link points to `.sdk-it`.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`

RED:

- Command: `nx run @sdk-it/cli:test`
- Result: the generated manifest exported `./src/index.ts` instead of the required JavaScript and declaration files.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 3 tests; a Node.js subprocess imported the linked generated package and observed the `Client` runtime export.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- The CLI uses the installed TypeScript compiler API to emit JavaScript and declarations.
- Relative `.ts` imports are rewritten during emit, while the generated source remains available for inspection.
- Generated runtime output targets ESNext, matching the existing SDK generator's target.

### 2026-07-09 — T05: Load `sdk-it.config.ts` through the shared API

Status: Complete

Delivered:

- `loadProjectConfig` is exported from `@sdk-it/cli`.
- It discovers `sdk-it.config.ts` from the current directory or a parent.
- It imports a config authored with `defineConfig`.
- It resolves `tsconfig` and output paths relative to the config file.
- It accepts an explicit working directory and configuration path.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`

RED:

- Command: `nx run @sdk-it/cli:test --skip-nx-cache`
- Result: the public package did not export `loadProjectConfig`.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 4 tests; a config discovered from a nested source directory resolved to fixed absolute project and output paths.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- Config discovery walks parent directories until it finds `sdk-it.config.ts`.
- Config loading remains separate from generation so CLI and Vite can share it.

### 2026-07-09 — T06: Generate through the CLI command

Status: Complete

Delivered:

- `sdk-it generate` discovers `sdk-it.config.ts` and delegates to `generateProject`.
- `--config` accepts an explicit TypeScript project config.
- The existing JSON configuration fallback remains available when no project config exists.
- Existing generator subcommands remain registered.

Files:

- `packages/cli/src/lib/cli.ts`
- `packages/cli/src/lib/public-api.test.ts`

RED:

- Command: `nx run @sdk-it/cli:test --skip-nx-cache`
- Result: the executable attempted to open the legacy `sdk-it.json` instead of the fixture's project config.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 5 tests; the executable generated the same JavaScript package shape as the programmatic API.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `node packages/cli/dist/bin.js generate typescript --help`
- Result: passed with exit code 0, confirming the existing TypeScript generator subcommand remains registered.
- Command: `git diff --check`
- Result: passed.

Decisions:

- TypeScript project configs take precedence over the legacy JSON config when both default paths are available.
- Explicit non-TypeScript config paths continue through the legacy JSON path.

### 2026-07-09 — T07: Detect the Prisma preset automatically

Status: Complete

Delivered:

- Project generation detects Prisma namespace imports in backend source files.
- Detection works with a custom generated-client module path.
- The automatic preset preserves the default analyzer mappings and maps Prisma `Decimal` to a wire-safe string.
- Generation reports the detected Prisma module.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`

RED:

- Command: `nx run @sdk-it/cli:test --skip-nx-cache`
- Result: the generated response exposed `price` as `models.Decimal` instead of `string`.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 6 tests; the custom Prisma fixture generated a response containing the fixed `'price': string` type.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- Automatic detection keys off imported Prisma namespaces rather than a package-manifest dependency alone.
- The preset extends `defaultTypesMap`; it does not replace SDK-IT's built-in mappings.

### 2026-07-09 — T08: Honor `preset: 'none'`

Status: Complete

Delivered:

- `preset: 'none'` disables Prisma detection and mappings.
- The analyzer retains its default representation of Prisma Decimal when the preset is disabled.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`

RED:

- Command: `nx run @sdk-it/cli:test`
- Result: the opt-out fixture still generated `'price': string`, proving the automatic preset ignored `none`.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 7 tests; the opt-out fixture generated the fixed `models.Decimal` type.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- `none` disables only optional presets; framework analysis and default type mappings remain active.

### 2026-07-09 — T09: Honor `preset: 'prisma'`

Status: Complete

Delivered:

- `preset: 'prisma'` requires a resolvable Prisma namespace import.
- Missing Prisma output fails before OpenAPI or client generation.
- The error names the backend project and suggests `prisma generate` or `preset: 'none'`.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`

RED:

- Command: `nx run @sdk-it/cli:test --skip-nx-cache`
- Result: forced Prisma generation completed instead of rejecting the project without Prisma.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed 8 tests; the forced-preset fixture rejected with the fixed actionable message.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- Forced preset validation happens before analysis to avoid producing a partially configured client.

### 2026-07-09 — T10: Generate through Vite without owning the pipeline

Status: Complete

Delivered:

- Calling `sdkIt()` selects the config-driven project workflow.
- The Vite plugin loads `sdk-it.config.ts` through `@sdk-it/cli`.
- It delegates generation to `generateProject` during server setup and production builds.
- Existing string, OpenAPI object, and callback inputs retain their current behavior.
- The integration adds no file watcher.

Files:

- `packages/vite/src/index.ts`
- `packages/vite/src/index.test.ts`
- `packages/vite/package.json`
- `packages/vite/tsconfig.json`
- `packages/vite/tsconfig.lib.json`

RED:

- Command: `nx run @sdk-it/vite:test --skip-nx-cache`
- Result: `sdkIt()` treated the missing first argument as an OpenAPI object and failed while hashing `undefined`.

GREEN:

- Command: `nx run @sdk-it/vite:test`
- Result: passed all 9 Vite tests; project generation produced the same endpoint source as direct CLI generation.

Additional verification:

- Command: `nx run @sdk-it/vite:typecheck`
- Result: passed.
- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- No-argument and `{ config }` calls select project generation.
- OpenAPI-shaped objects remain distinguishable by their required `openapi` property.

### 2026-07-09 — T11: Initialize `.sdk-it` repository settings safely

Status: Complete

Delivered:

- `initializeProject` adds `.sdk-it/` to `.gitignore` without removing existing rules.
- It registers `.sdk-it` in array and object-style npm workspace configurations.
- It creates `sdk-it.config.ts` with a config-relative backend path.
- Repeated initialization does not duplicate entries or rewrite matching configuration.
- Conflicting configuration produces an error before repository files change.
- `sdk-it init --project <tsconfig>` exposes the noninteractive project path while preserving the existing interactive initializer.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`
- `packages/cli/src/lib/commands/init.ts`

RED:

- Command: `node --test --test-name-pattern=initializeProject packages/cli/src/lib/public-api.test.ts`
- Result: the public package did not export `initializeProject`.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed all CLI integration tests; two initialization calls preserved the fixed `.gitignore`, workspace list, and config contents.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `node packages/cli/dist/bin.js init --help`
- Result: passed and lists the project initializer option.
- Command: `git diff --check`
- Result: passed.

Decisions:

- The reusable repository mutation lives in the side-effect-free CLI library API.
- The interactive command remains backward compatible; project initialization is also available explicitly through `--project`.

### 2026-07-09 — T12: Avoid rewriting an unchanged generated package

Status: Complete

Delivered:

- Project generation hashes the analyzed OpenAPI document and package settings.
- A matching successful generation skips source generation, compilation, and manifest writes.
- The hash is stored inside `.sdk-it`, which is already generated and ignored.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`

RED:

- Command: `node --test --test-name-pattern="does not rewrite" packages/cli/src/lib/public-api.test.ts`
- Result: the second generation changed the generated package manifest timestamp.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed all CLI tests; the manifest timestamp remains identical after unchanged regeneration.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- The hash is written only after source generation and compilation succeed, so failed runs remain retryable.

### 2026-07-09 — T13: Finish documentation and package metadata

Status: Complete

Delivered:

- Added a user guide for installation, initialization, CLI generation, programmatic generation, Vite, Prisma overrides, fresh clones, and CI.
- Linked the shipped workflow from the repository README.
- Kept the recipe limited to behavior that is implemented.
- Added the CLI's analyzer/framework dependencies and TypeScript peer range.
- Added the Vite-to-CLI peer dependency and TypeScript project references.
- Updated the package lockfile.

Files:

- `docs/recipes/backend-to-client.md`
- `README.md`
- `packages/cli/package.json`
- `packages/vite/package.json`
- `package-lock.json`

Verification:

- Command: `npx prettier --write README.md docs/recipes/backend-to-client.md packages/cli/package.json packages/vite/package.json todo.md progress.md`
- Result: passed.
- Command: `npm install --package-lock-only --ignore-scripts`
- Result: passed; npm reported only the repository's existing Node 25 engine warning for `httpsnippet`.
- Command: `git diff --check`
- Result: passed.

Decisions:

- The recipe documents shipped behavior and avoids presenting unfinished options.

### 2026-07-09 — T14: Run final verification

Status: Complete

Delivered:

- Completed the CLI and Vite integration verification sweep.
- Reviewed the final worktree for unrelated edits and generated-file churn.
- Confirmed the implementation contains no watch command or watcher behavior.

Verification:

- Command: `nx run @sdk-it/cli:test`
- Result: passed all CLI integration tests.
- Command: `nx run @sdk-it/vite:test`
- Result: passed all Vite integration tests.
- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `nx run @sdk-it/vite:typecheck`
- Result: passed.
- Command: `npx prettier --check README.md docs/recipes/backend-to-client.md packages/cli/src packages/vite/src packages/cli/package.json packages/vite/package.json packages/cli/project.json packages/cli/tsconfig.json packages/cli/tsconfig.lib.json packages/cli/tsconfig.test.json packages/vite/tsconfig.json packages/vite/tsconfig.lib.json todo.md progress.md`
- Result: passed.
- Command: `git diff --check`
- Result: passed.
- Command: `rg -n "sdk-it watch|sdk:watch|Watch without|shared watcher" README.md docs/recipes/backend-to-client.md todo.md progress.md packages/cli packages/vite --glob '!**/dist/**'`
- Result: no matches.

Decisions:

- No generated `dist` output is included in the source diff.
- The guide, implementation files, and trackers remain intentional untracked additions until the user stages or commits them.

### 2026-07-10 — T15: Consolidate documentation and complete code review

Status: Complete

Delivered:

- Removed the obsolete design document and README section.
- Made `docs/recipes/backend-to-client.md` the single user-facing source of truth.
- Corrected CI examples to invoke the installed scoped CLI package.
- Documented the current Hono-only, generate-once, no-watch scope.
- Updated Vite tests to import the public `@sdk-it/vite` package surface.
- Ran a dedicated code-review agent and addressed every actionable finding.

Files:

- `README.md`
- `docs/recipes/backend-to-client.md`
- `todo.md`
- `progress.md`
- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`
- `packages/vite/src/index.ts`
- `packages/vite/src/index.test.ts`
- `packages/vite/package.json`
- `package-lock.json`

Code-review findings addressed:

- Explicit `framework: 'auto'` now runs framework detection instead of failing.
- Prisma imports must resolve through the backend TypeScript project before enabling the preset.
- Detected `Prisma` and `$Enums` modules are injected into analyzer schema evaluation.
- Vite overloads require generator settings for legacy OpenAPI inputs while allowing no-argument project mode.
- Vite loads the optional CLI peer only when project generation is selected.
- The unchanged-generation hash includes CLI and TypeScript generator versions.

Verification:

- Command: `nx run @sdk-it/cli:test`
- Result: passed, including explicit-auto and Prisma namespace regression coverage.
- Command: `nx run @sdk-it/vite:test`
- Result: passed with package-specifier imports.
- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `nx run @sdk-it/vite:typecheck`
- Result: passed.
- Command: `npx prettier --check README.md docs/recipes/backend-to-client.md todo.md progress.md packages/cli/src packages/vite/src packages/cli/package.json packages/vite/package.json`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- `@sdk-it/cli` remains an optional Vite peer and is imported lazily, preserving OpenAPI-only Vite consumers.
- Generator package versions form part of cache identity so upgrades regenerate `.sdk-it`.

### 2026-07-10 — T16: Fix final audit edge cases

Status: Complete

Delivered:

- Removed the unused OpenAPI-output option from the public project config.
- Cache hits now require the generated manifest, JavaScript entry, and declaration entry to exist.
- Missing generated runtime files trigger regeneration even when the project hash matches.
- Initialization parses and validates `package.json` before modifying `.gitignore` or creating configuration.
- Repeated initialization no longer rewrites an unchanged package manifest.
- Prisma detection collects separate namespace imports and supports local aliases.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`
- `todo.md`
- `progress.md`

Regression coverage:

- Explicit `framework: 'auto'` detects Hono.
- Separate `$Enums` and aliased Prisma imports generate successfully.
- Invalid package metadata leaves repository files unchanged.
- Deleting `.sdk-it/dist/index.js` invalidates a matching generation hash and repairs the package.

Verification:

- Command: `nx run @sdk-it/cli:test`
- Result: passed all CLI integration tests.
- Command: `nx run @sdk-it/vite:test`
- Result: passed all Vite integration tests.
- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `nx run @sdk-it/vite:typecheck`
- Result: passed.
- Command: `npx prettier --check README.md docs/recipes/backend-to-client.md todo.md progress.md packages/cli/src packages/vite/src packages/cli/package.json packages/vite/package.json`
- Result: passed.
- Command: `git diff --check`
- Result: passed.

Decisions:

- The in-memory OpenAPI document remains an internal pipeline value until a real emitted-spec option is implemented and tested.
- Cache validity covers both input identity and the minimum executable package shape.

### 2026-07-10 — T17: Fix clean verification regressions

Status: Complete

Delivered:

- Vite project-option narrowing now accepts the complete overload input union, including legacy string specs.
- Vite library compilation excludes integration tests; a separate referenced test config type-checks package-specifier imports without reading its own declaration output.
- The Prisma opt-out fixture no longer relies on `$Enums` injection after explicitly disabling the Prisma preset.

Files:

- `packages/vite/src/index.ts`
- `packages/vite/tsconfig.json`
- `packages/vite/tsconfig.lib.json`
- `packages/vite/tsconfig.test.json`
- `packages/cli/src/lib/public-api.test.ts`
- `todo.md`
- `progress.md`

RED:

- Command: `nx run @sdk-it/cli:test`
- Result: 11 passed and 1 failed because the opt-out fixture still referenced the deliberately uninjected `$Enums` runtime.
- Command: `nx run @sdk-it/vite:test`
- Result: the build failed with TS2345 in project-option narrowing and TS5055 because the library config included a package-importing test in its declaration output.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed all 12 integration tests.
- Command: `nx run @sdk-it/vite:test`
- Result: passed all 9 integration tests.

Additional verification:

- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `nx run @sdk-it/vite:typecheck`
- Result: passed.

Decisions:

- Package-specifier imports remain mandatory in tests; build and test TypeScript projects own separate outputs.
- `preset: 'none'` disables Prisma-specific analyzer imports and mappings, so its fixture must not require those imports to evaluate a validation schema.

### 2026-07-10 — T18: Address final review findings

Status: Complete

Delivered:

- A cache miss now synchronizes the generated package name, runtime entry fields, exports, publish metadata, and required dependencies.
- Cache validation walks generated TypeScript sources and requires the matching nested JavaScript and declaration artifacts.
- The TypeScript compiler version is part of cache identity.
- The CLI and guide consistently support TypeScript `^5.8.3`, matching the analyzer packages.
- Initialization rejects a missing or non-file tsconfig before changing `.gitignore`, `package.json`, or configuration.
- Analyzer import injection can select a named module property, so aliased `Prisma` and `$Enums` bindings retain their source semantics.

Files:

- `packages/cli/src/lib/project.ts`
- `packages/cli/src/lib/public-api.test.ts`
- `packages/cli/package.json`
- `packages/core/src/lib/zod-jsonschema.ts`
- `package-lock.json`
- `docs/recipes/backend-to-client.md`
- `todo.md`
- `progress.md`

RED:

- Command: `node --test packages/cli/src/lib/public-api.test.ts`
- Result: 10 passed and 4 failed, exposing named Prisma binding evaluation, missing-tsconfig initialization, nested artifact repair, and package metadata regeneration defects.
- Note: the focused Node command was used after Nx waited on the editor's project-graph worker; final GREEN verification used the required Nx targets.

GREEN:

- Command: `nx run @sdk-it/cli:test`
- Result: passed all 14 integration tests.
- Command: `nx run @sdk-it/core:test`
- Result: passed with 140 passing tests and 64 existing TODO cases.
- Command: `nx run @sdk-it/vite:test`
- Result: passed all 9 integration tests.

Additional verification:

- Command: `nx run @sdk-it/core:typecheck`
- Result: passed.
- Command: `nx run @sdk-it/cli:typecheck`
- Result: passed.
- Command: `nx run @sdk-it/vite:typecheck`
- Result: passed.
- Command: `npm pack --dry-run --workspace @sdk-it/cli`
- Result: passed; the tarball includes the separate executable and library entrypoints.
- Command: `npm pack --dry-run --workspace @sdk-it/vite`
- Result: passed; the optional project adapter is present in the published runtime.
- Review: the follow-up code-review agent confirmed all six targeted fixes and reported no actionable findings.

Decisions:

- The CLI documents and declares TypeScript `^5.8.3` rather than widening the peer contract of existing analyzer packages.
- Generated package metadata remains owned by SDK-IT; unrelated dependency entries are preserved while required runtime dependencies are corrected.

## Progress-entry template

### YYYY-MM-DD — TXX: Title

Status: Complete

Delivered:

- Observable behavior.

Files:

- `path/to/file`

RED:

- Command: `nx run <project>:test`
- Result: expected failure and why it proved the behavior was missing.

GREEN:

- Command: `nx run <project>:test`
- Result: passing test summary.

Additional verification:

- Typecheck, formatting, or compatibility commands and results.

Decisions:

- Any choice that changes later items, or `None`.
