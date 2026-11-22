# @sdk-it/nx

Keeps each committed derived OpenAPI document of an Nx workspace in step with the backend it is derived from. It ships one Nx sync generator, `openapi-sync`. `nx sync` writes every stale document, and `nx sync:check` fails when one is stale.

A derived document is the file an app imports to get its backend's client: `import { createBackend } from '#backend'`, where `#backend` is `src/backend.openapi`, and the app's tsconfig names the backend's definition module (`contentMappers[].options.derived`, see [`@sdk-it/content-mapper`](../content-mapper/README.md)). TypeScript needs the file to exist before it resolves the import, so the document is committed. The readers (the content mapper in `tsc` and the editor, `sdkIt.imports()` in Vite, the Node hook) derive it from the backend in memory each time and never write it. This generator is its only writer.

## Register the generator

```jsonc
// nx.json
{
  "sync": { "globalGenerators": ["@sdk-it/nx:openapi-sync"] },
}
```

The generator takes no options: Nx 24 passes a sync generator nothing but the tree. It reads every declaration from the tsconfig files themselves.

## Keep the documents fresh

| You run                                                  | What happens underneath                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nx sync`                                                | For each project in the project graph, each `tsconfig*.json` with a `derived` entry for `@sdk-it/content-mapper`: each document is derived from its backend (`@sdk-it/openapi`'s `generateDocument`), and written when its bytes differ. |
| `nx sync:check` (CI)                                     | The same, writing nothing: exits 1 and names each stale document.                                                                                                                                                                        |
| A pre-commit hook that runs `nx sync` (zukhruf's `Sync`) | Writes and stages each document the commit makes stale, into the same commit. A backend that needs generated code (a Prisma client) gets it from `Sync`'s `before` targets.                                                              |
| `nx run <target>`                                        | Nothing: a global sync generator never runs before a task, so no task pays for an analysis.                                                                                                                                              |
| The editor, `tsc`, a Vite dev server                     | Nothing is written. Each derives the document in memory from the backend as it is now.                                                                                                                                                   |

## Errors

- A backend that does not analyze (a definition that does not load, `generateDocument` throws) fails `nx sync` and `nx sync:check` with the analysis message and the document it was for.
- A `derived` entry whose definition module does not exist fails the same way.

## The same concepts in other systems

| System                      | Derived file                                         | Writer                                    | Check           |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------- | --------------- |
| Nx `@nx/js:typescript-sync` | tsconfig project references (committed)              | a sync generator, via the project graph   | `nx sync:check` |
| `@juristr/nx-tailwind-sync` | Tailwind `@source` lines in `styles.css` (committed) | a sync generator, via the project graph   | `nx sync:check` |
| TanStack Router             | `routeTree.gen.ts` (managed, read-only)              | its Vite plugin, at dev and build         | none            |
| SvelteKit                   | `.svelte-kit` types (gitignored)                     | `svelte-kit sync` as the `prepare` script | none            |

## npm candidates

Searched "nx sync generator openapi", "nx plugin openapi sync", "openapi document nx sync". `@driimus/nx-plugin-openapi` generates libraries _from_ a spec; none derives a spec from a TypeScript backend or keeps a committed one in step.

## Who uses what

- `@sdk-it/nx` depends on `@nx/devkit` (the tree, `createProjectGraphAsync`) and on `@sdk-it/content-mapper` (`DerivedDocument`).
- `@sdk-it/content-mapper` exports `DerivedDocument`, and its readers stop writing ([ADR 0001](./docs/adr/0001-the-sync-generator-is-the-only-writer-of-a-derived-document.md), [ADR 0004](./docs/adr/0004-content-mapper-exports-the-derived-documents-of-a-tsconfig.md)).
- First consumers: meddit (`apps/web/src/backend.openapi`) and deepagents (`apps/evals-web-runner/frontend/src/evals.openapi`).

## Now, later, never

| Now                               | Later                                                                                                           | Never                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| the `openapi-sync` sync generator | a generator that sets up a derived document in an app (the tsconfig entry, `openapi.ts`, the `#backend` import) | a CLI command or an executor that writes documents; formatting the document |
