## SDK-IT Packages Overview

Brief descriptions of each package in the monorepo. These summaries focus on purpose and primary responsibilities (not exhaustive APIs). We will refine further during the week as needed.

| Package              | Description                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sdk-it/apiref`     | React and @zukhruf/shadcn (Base UI) powered API reference web app that renders generated SDK/OpenAPI documentation with markdown, code highlighting, and interactive navigation.                      |
| `@sdk-it/cli`        | Command-line interface to generate, format, and publish SDKs (TypeScript, Dart, Python) from OpenAPI specs; coordinates generators and ancillary assets (project scaffolding, README).                |
| `@sdk-it/core`       | Low-level TypeScript analysis & utility primitives (tsconfig parsing, program creation, AST/type helpers, zod→json schema conversion) used by higher-level analyzers and generators.                  |
| `@sdk-it/dart`       | OpenAPI → Dart SDK generator producing type-safe client classes, models, and request/response handling suitable for Dart & Flutter projects.                                                          |
| `@sdk-it/generic`    | Framework-agnostic TypeScript code analyzer extracting routes + validation metadata to build OpenAPI specs; supports custom type maps, external schema imports, and operation/tag tuning.             |
| `@sdk-it/hono`       | Hono framework integration: validation & content-type middleware, response helpers, and response analyzer enabling accurate OpenAPI generation from Hono apps.                                        |
| `@sdk-it/python`     | OpenAPI → Python async SDK generator (httpx transport, Pydantic models, structured error hierarchy, typed inputs/outputs).                                                                            |
| `@sdk-it/readme`     | Documentation/README generation utilities that derive human-readable usage/reference content from specs & IR (consumed by CLI and generators).                                                        |
| `@sdk-it/rpc`        | Runtime RPC client & agent tool builder – turns OpenAPI operations into dispatchable endpoints and optionally AI agent tool definitions with Zod-validated inputs.                                    |
| `@sdk-it/spec`       | Spec processing/tuning layer: loads local/remote OpenAPI, builds intermediate representation (IR), normalizes operations, names, polymorphism, security, sidebar metadata. Foundation for generators. |
| `@sdk-it/typescript` | OpenAPI → TypeScript SDK generator producing a cross-runtime, fully typed client; configurable output structure & optional post-generation formatting hooks.                                          |
| `@sdk-it/vite`       | Vite plugin that generates a TypeScript SDK from a local OpenAPI spec at build start and again in dev when the spec or a file it references through `$ref` changes (single-flight generation).        |

### Cross-package invariants

- **Hosts follow the package.** `@sdk-it/spec`'s IR is the single source of truth for what an operation means: its inputs, its responses, and each response's body kind. Generators (`typescript`, `dart`, `python`) and runtimes (`rpc`, `command`) read the IR. A host never parses another host's rendered output (emitted code strings), and never re-derives a fact the IR already records. When a host needs a fact the IR lacks, the fact goes into spec, which every host then follows. Never add API to a generator package for one host's sake.

- **64-bit integers are not special.** The generated type follows the wire encoding: `type: integer, format: int64/uint64` → `number` (`z.number().int()`), `type: string, format: int64/uint64` → `string` (`z.string()`). No `bigint`, no runtime revival machinery — a `type: integer` value past 2^53 is a lossy `number`, and the fix is to encode 64-bit IDs as strings (protobuf-JSON style). `z.int64()`/`z.bigint()` in server code still emit `format: int64` in the spec as documentation. See `docs/recipes/int64-bigint.md` before touching int64 handling.

### TypeScript 7

- **Two TypeScript packages.** The root `typescript` package is the TypeScript 6 API. Nx and typescript-eslint load it. The npm alias `@typescript/native` is the TypeScript 7.1 compiler and API. `npx tsc` runs TypeScript 7.1.
- **Shipped code imports only `@typescript/native/*`.** The ESLint `no-restricted-imports` rule rejects imports of `typescript` and `typescript/*`.
- **Dependency kind.** A package that runs the compiler (`generic`, `cli`) has `@typescript/native` as a regular dependency. `core` and `hono` declare it as an optional peer, so a runtime-only install (such as `@sdk-it/hono/runtime`) has no compiler.
- **`@nx/dependency-checks` cannot read npm alias specs.** Each package that uses `@typescript/native` sets `ignoredDependencies: ['@typescript/native']` on that rule.
- **`npx tsc -v` reports 6.x.** This can occur after an incremental install, because two packages ship a `tsc` bin. Run `npm ci`.
- **Declarations.** The inferred `build-types` target (`tsc --build tsconfig.lib.json`) emits the published `.d.ts` files. esbuild emits only JavaScript.
- **Project references.** When a tsconfig has `references`, the TypeScript 7.1 API program reads each referenced package as source, not as its `.d.ts` (`tsc` and TypeScript 6 read the `.d.ts`). So `analyze` follows calls into workspace packages: a call whose value the handler returns adds the callee's returns and throws, and any other call adds only its throws (`returnTokens` in `packages/generic/src/lib/generic.ts`). The redirect needs matching paths, so `openAnalysisProject` opens the tsconfig by its real path, and the program names its files by real path.

### Notes & Next Refinements

Planned follow-ups: add cross-package dependency graph, highlight shared IR flow (`spec` → generators), and document extension points (custom type maps, response analyzers).

### Releasing

- Run `npx nx release --skip-publish` (build, e2e gate, version bump, commit, `release/<version>` tag), then `npx nx release publish`. Nx loads `NPM_ACCESS_TOKEN` from the gitignored `.env`, and `.npmrc` reads it. Never set or override that variable: a session token in its place makes npm refuse the publish with 403.
- All packages form one fixed release group. `--projects` is refused, so to repair a partial publish, re-run `npx nx release publish`, which skips versions already on npm.
- Before pushing or announcing a release, check that every package's tarball (`https://registry.npmjs.org/@sdk-it/<name>/-/<name>-<version>.tgz`) returns 200. The packages pin each other's exact version, so one missing tarball breaks every install.

### Building a package

To build a package, run the following command

```bash
nx run <package-name>:build
```

## Testing

- Focus on **integration tests** that test entire flows, not unit tests for individual functions.

### Running Tests

```sh
node --test path/to/package/test/file.test.ts
```

### Test Import Rules

- **Always use package module specifiers** in test files, not relative source paths:

  ```typescript
  // ✅ CORRECT
  import { tables, Sqlite } from '@deepagents/text2sql/sqlite';

  // ❌ WRONG - causes type mismatches
  import { tables } from './index.ts';
  ```

- **Why**: TypeScript treats private class members (`#field`) as unique per class declaration. Mixing imports from built packages and source files creates two incompatible types.
