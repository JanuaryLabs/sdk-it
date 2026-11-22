# Import an OpenAPI document as a module

An application that owns its OpenAPI document can import it and get its client, with no generated files:

```ts
import { createStore, store } from './store.openapi.yaml';

const pet = await store.request('GET /pets/{petId}', { petId: 'p1' });
```

`tsc` and the editor type the import through a TypeScript 7.1 content mapper (`@sdk-it/content-mapper`). The code that runs it loads the document too: Vite through `sdkIt.imports()` from `@sdk-it/vite`, and Node through `node --import @sdk-it/content-mapper/register`. Each one renders the document with the same `renderDocument`, so the types and the running code cannot drift.

When other packages or repositories import the client, generate a package instead: [Generate a client from a TypeScript backend](./backend-to-client.md) or [Use SDK-IT programmatically](./workspace-sdk.md).

## Install

```bash
npm install zod fast-content-type-parse
npm install --save-dev @sdk-it/content-mapper typescript@7.1.0-beta
```

Content mappers need TypeScript 7.1, which is in beta until 7.1.0 ships. The module holds the client's runtime, which imports `zod` and `fast-content-type-parse`. Add `@sdk-it/vite` when the application uses Vite.

## Name the document

The file name before its first `.` names the exports. `store.openapi.yaml` exports `store`, `createStore`, `StoreClient`, `StoreSettings` and `StoreEndpoints`, the names `generate` gives an SDK named `store`. `store` exists only when the document names at most one server; `createStore` always does.

Use `.openapi.yaml` for a YAML document and `.openapi` for a JSON one. TypeScript refuses a mapped extension that ends in `.json` (TS18066).

## Type the import

```jsonc
// tsconfig.json
{
  "compilerOptions": { "module": "nodenext" },
  "contentMappers": [
    {
      "package": "@sdk-it/content-mapper",
      "extensions": [".openapi", ".openapi.yaml"],
    },
  ],
}
```

```bash
npx tsc --runExternalCode
```

In a project that `tsc --build` checks, such as one where Nx infers the `typecheck` target, pass `--runExternalCode` to that command too, and list the document in `include` (for example `"src/**/*.openapi"`): a `composite` project refuses an import of a file it does not list (TS6307). The module type-checks under the DOM lib and under Node's types alone (`lib: ["esnext"]` with `@types/node`).

In the editor, the TypeScript 7.1 language server runs content mappers when its initialization options set `runExternalCode`. Go to definition on the client, a model or an endpoint key lands where the document declares it. A document that does not render is reported in the document itself, at its line and column (see the diagnostics in [`@sdk-it/content-mapper`](../../packages/content-mapper/README.md#diagnostics)).

## Run it with Vite

```ts
// vite.config.ts
import sdkIt from '@sdk-it/vite';

export default { plugins: [sdkIt.imports()] };
```

In dev, an edit to the document or to a file it references through `$ref` reloads the module. A build bundles the client like any other module.

## Run it with Node

```bash
node --import @sdk-it/content-mapper/register main.ts
```

A document that does not render fails the import with `<file>:<line>:<column>: <message>`.

## Import your own backend

When the backend is in the same repository, the app imports the backend's document without a generation step. The backend's `openapi.ts` says how its document is produced ([`@sdk-it/openapi`](../../packages/openapi/README.md)):

```ts
// apps/backend/openapi.ts
import { defineOpenApi } from '@sdk-it/openapi';

export default defineOpenApi({
  tsconfig: new URL('./tsconfig.app.json', import.meta.url),
  document: { openapi: '3.1.0', info: { title: 'Backend', version: '1.0.0' } },
});
```

The app's tsconfig names it as the source of a document the app imports:

```jsonc
// apps/web/tsconfig.app.json
{
  "contentMappers": [
    {
      "package": "@sdk-it/content-mapper",
      "extensions": [".openapi"],
      "options": {
        "derived": { "src/backend.openapi": "../backend/openapi.ts" },
      },
    },
  ],
  "include": ["src/**/*.ts", "src/**/*.openapi"],
}
```

```ts
// apps/web/src/api.ts
import { createBackend } from './backend.openapi';

export const api = createBackend({ baseUrl: '/' });
```

Every reader generates the document from the backend's code and rewrites `src/backend.openapi` when it changed: the content mapper in `tsc` and the editor, `sdkIt.imports()` in Vite, and `@sdk-it/content-mapper/register` in Node. Vite and Node find the declaration from the tsconfig*.json files between the document and its package root. A save in the backend re-types the import and reloads the dev module.

- **Commit the document.** TypeScript resolves the import before the content mapper runs, so a missing document is TS2307 that the mapper cannot prevent. The committed document also shows each API change in review.
- **In an Nx workspace, declare the backend as an implicit dependency** (`"nx": { "implicitDependencies": ["@acme/backend"] }` in the app's package.json, or `implicitDependencies` in its project.json). The app imports none of the backend's code, so Nx sees no edge from its imports, and without one the app's cached `typecheck`, `build` and `test` and `nx affected` miss a backend change. The content mapper reports a missing edge as `sdk-it5` at the tsconfig's `derived` entry. A devDependency on the backend's package is an edge too, but a bundled app then has to declare the backend's packages for `@nx/dependency-checks`.
- **The backend's openapi.ts never ships.** It imports `@sdk-it/openapi`, which belongs in the backend's devDependencies. `@nx/dependency-checks` reads every production file, so give it `ignoredFiles: ['{projectRoot}/openapi.ts']`. Keep the file a production input, so a change to it reaches the app's cached targets.
- A backend that does not analyze is diagnostic `sdk-it4` on the document.
- The editor waits for the analysis on each backend save (about 0.6 s for a backend of 18 operations).

## Limits

- The module holds every operation of the document, so a bundle ships the whole endpoint table.
- In `tsc` and the editor, a change to a file that the document references through `$ref` does not re-type the import until the document itself changes.
- In Vite, a document referenced over http(s) is read each time the module loads, and is not watched.
- A large document is slow to re-type and to reload. On App Store Connect (1,300 operations, a 7.6 MB JSON document that renders a 3.5 MB module), an edit reaches the editor's diagnostics in about 2.5 to 5.5 s, `tsc` checks the project in about 9 s, and a Vite dev reload takes about 2 to 4 s (measured 2026-11-20).
- `sdkIt.imports()` keeps the dev server's heap flat across reloads. Vite's SSR runner compiles each module from a string, and V8 keeps every such source in its eval cache, so each reload of a plain `.ts` file of the same size keeps about 30 MB more. The module that `sdkIt.imports()` serves ends with a tagged template, which V8 does not cache.

## Where it is proven

On every release, the network e2e suite (`nx run @sdk-it/source:test-network`) downloads 11 public API documents, among them App Store Connect, Box, Discord, Figma and Spotify, and imports each one through `tsc`, Node and a Vite build.
