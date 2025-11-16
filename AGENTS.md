## SDK-IT Packages Overview

Brief descriptions of each package in the monorepo. These summaries focus on purpose and primary responsibilities (not exhaustive APIs). We will refine further during the week as needed.

| Package              | Description                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sdk-it/apiref`     | React/Radix UI powered API reference web app that renders generated SDK/OpenAPI documentation with markdown, code highlighting, and interactive navigation.                                           |
| `@sdk-it/cli`        | Command-line interface to generate, format, and publish SDKs (TypeScript, Dart, Python) from OpenAPI specs; coordinates generators and ancillary assets (project scaffolding, README).                |
| `@sdk-it/client`     | Runtime TypeScript HTTP client with strongly typed request/response handling, pagination iterator, error class hierarchy, and dynamic validation hooks.                                               |
| `@sdk-it/core`       | Low-level TypeScript analysis & utility primitives (tsconfig parsing, program creation, AST/type helpers, zod→json schema conversion) used by higher-level analyzers and generators.                  |
| `@sdk-it/dart`       | OpenAPI → Dart SDK generator producing type-safe client classes, models, and request/response handling suitable for Dart & Flutter projects.                                                          |
| `@sdk-it/generic`    | Framework-agnostic TypeScript code analyzer extracting routes + validation metadata to build OpenAPI specs; supports custom type maps, external schema imports, and operation/tag tuning.             |
| `@sdk-it/hono`       | Hono framework integration: validation & content-type middleware, response helpers, and response analyzer enabling accurate OpenAPI generation from Hono apps.                                        |
| `@sdk-it/python`     | OpenAPI → Python async SDK generator (httpx transport, Pydantic models, structured error hierarchy, typed inputs/outputs).                                                                            |
| `@sdk-it/readme`     | Documentation/README generation utilities that derive human-readable usage/reference content from specs & IR (consumed by CLI and generators).                                                        |
| `@sdk-it/rpc`        | Runtime RPC client & agent tool builder – turns OpenAPI operations into dispatchable endpoints and optionally AI agent tool definitions with Zod-validated inputs.                                    |
| `@sdk-it/shadcn`     | Internal UI component library (Radix + Tailwind variants) centralizing styled, accessible building blocks for docs/apps (accordion, dialogs, menus, forms, etc.).                                     |
| `@sdk-it/spec`       | Spec processing/tuning layer: loads local/remote OpenAPI, builds intermediate representation (IR), normalizes operations, names, polymorphism, security, sidebar metadata. Foundation for generators. |
| `@sdk-it/typescript` | OpenAPI → TypeScript SDK generator producing a cross-runtime, fully typed client; configurable output structure & optional post-generation formatting hooks.                                          |
| `@sdk-it/vite`       | Vite plugin that watches an OpenAPI spec (local or remote) and auto-generates/refreshes a TypeScript SDK during dev & build (single-flight generation).                                               |

### Notes & Next Refinements

Planned follow-ups: add cross-package dependency graph, highlight shared IR flow (`spec` → generators), and document extension points (custom type maps, response analyzers).

### Building a package

To build a package, run the following command

```bash
nx run build <package-name>
```
