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

## Limits

- The module holds every operation of the document, so a bundle ships the whole endpoint table.
- In `tsc` and the editor, a change to a file that the document references through `$ref` does not re-type the import until the document itself changes.
- In Vite, a document referenced over http(s) is read each time the module loads, and is not watched.
- A large document is slow to re-type and to reload. On App Store Connect (1,300 operations, a 7.6 MB JSON document that renders a 3.5 MB module), an edit reaches the editor's diagnostics in about 2.5 to 5.5 s, `tsc` checks the project in about 9 s, and a Vite dev reload takes about 2 to 4 s (measured 2026-11-20).
- Vite 8.3's dev server holds about 30 MB more after each server-side (`ssrLoadModule`) reload of that 3.5 MB module. A plain `.ts` file of the same size does the same, so the growth is Vite's. Restart the dev server after many edits to a large document.

## Where it is proven

On every release, the network e2e suite (`nx run @sdk-it/source:test-network`) downloads 11 public API documents, among them App Store Connect, Box, Discord, Figma and Spotify, and imports each one through `tsc`, Node and a Vite build.
