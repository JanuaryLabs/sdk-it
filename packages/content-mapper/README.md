# @sdk-it/content-mapper

A TypeScript 7.1 content mapper. When a TypeScript file imports an OpenAPI document, TypeScript runs this package, sends it the document's text, and gets back the SDK of that document as one TypeScript module. The import is typed in `tsc` and in the editor, and go to definition on a model, an endpoint or the client lands in the document.

```ts
import { type StoreEndpoints, createStore, store } from './store.openapi.yaml';

const pet = await store.request('GET /pets/{petId}', { petId: 'p1' });
```

It gives types only: TypeScript never emits JavaScript for a mapped file. To run the import, the host that runs the code loads the document too: the Vite plugin `sdkIt.imports()` from `@sdk-it/vite`, and in Node this package's loader:

```bash
node --import @sdk-it/content-mapper/register main.ts
```

The loader renders a `file:` import that ends with `.openapi.yaml` or `.openapi` and gives Node the module as TypeScript, which Node strips. A document that does not render fails the import with `<file>:<line>:<column>: <message>`. Node's load hook is synchronous, so a worker thread renders while the hook waits (zukhruf #4966 will own that bridge). Each host renders the document with this package's `renderDocument`, so the types and the running code come from one render.

## Render a document in another host

```ts
import { renderDocument } from '@sdk-it/content-mapper';

const rendered = await renderDocument(fileName, content);
if (rendered.kind === 'failed') {
  // rendered.diagnostics: at least one; each has a code (DiagnosticCode), a message and a range of `content`
} else {
  // rendered.text: the SDK as one TypeScript module; rendered.mappings: each name and where the document declares it
}
// rendered.documents: the URI of each document read, `fileName` first, also when rendering failed
```

## Set up a project

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

[Import an OpenAPI document as a module](../../docs/recipes/import-openapi-document.md) sets up all three hosts: types, Vite and Node.

```bash
npx tsc --runExternalCode
```

`tsc --build` takes `--runExternalCode` too, as Nx's inferred `typecheck` target runs it. A `composite` project must list the document in `include` (for example `"src/**/*.openapi"`), or TypeScript reports TS6307 for the import. The build then also emits a declaration for the document (`<name>.d.openapi.ts`).

In the editor, the TypeScript 7.1 language server runs content mappers when its initialization options set `runExternalCode`.

The mapper takes no options. The names come from the file name before its first `.`: `store.openapi.yaml` exports `store`, `createStore`, `StoreClient`, `StoreSettings` and `StoreEndpoints`, the names `generate` gives an SDK named `store`.

A JSON document needs an extension that does not end in `.json`, such as `.openapi`: TypeScript refuses a mapped extension that ends in `.json` (TS18066). YAML reads JSON text.

## What happens on each import

| TypeScript does                                                                              | the mapper does underneath                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| starts the mapper with the manifest's `exec`, `node ./dist/server.js`                        | `runContentMapper` from `ts-content-mapper` answers `initialize` with the position encoding TypeScript offers and the diagnostic source `sdk-it`                                                                                              |
| sends `transform(fileName, content)`; `content` is the editor's text, unsaved edits included | `parseDocument(content)` from `yaml` keeps each node's range                                                                                                                                                                                  |
|                                                                                              | `new SpecLoader(Documents.standard([[fileUrl, document]])).load(fileUrl)` from `@sdk-it/spec`: the files the document references through `$ref` are read from disk or http, the document itself is never read again                           |
|                                                                                              | `renderModule(spec, { name })` from `@sdk-it/typescript`                                                                                                                                                                                      |
|                                                                                              | `MappedCodeBuilder` maps each span of the module to the range of what the document declares there: the endpoint key to its method key, a model to its `components.schemas` key, the client and the default instance to the `info.title` value |
| gets `{ text, extension: '.ts', mappings, diagnostics }`                                     | a span whose location is in another document has no mapping                                                                                                                                                                                   |

Mappings are for navigation only: definition, type definition, references, hover and document highlights. A rename never edits the document.

## Diagnostics

Each diagnostic has the source `sdk-it` and reads `error sdk-it<code>`. Codes 1 to 4 are in the document, and code 5 is in the app's tsconfig.

| code | when                                                                                                                        | where                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1    | the YAML does not parse                                                                                                     | the range the YAML parser reports, kept inside the text                                 |
| 2    | a `$ref` does not resolve, or a document it names cannot be read                                                            | the `$ref` value when the reference is in this document, else the start of the document |
| 3    | the SDK cannot be rendered: the file name is not an identifier, a spec name clashes, a security requirement names no scheme | the start of the document                                                               |
| 4    | a derived document's backend does not analyze (its definition does not load, or `generateDocument` throws)                  | the start of the document                                                               |
| 5    | in an Nx workspace, the app's project has no edge to the project of a derived document's backend                            | the document's entry in the tsconfig's `derived` option                                 |

YAML that still parses into a document keeps rendering while you type, with its YAML errors. When a step fails, the module is `export {};`, so each importer sees the missing names until the document is fixed; when the YAML has errors, only they are reported, since the later failure follows from them. `tsc` reports no semantic error of any file while a mapped document has a diagnostic, so the missing names show in the editor, which checks each file on its own.

## Derived documents

A tsconfig's `contentMappers[].options.derived` maps a document to a backend's `@sdk-it/openapi` definition module (`{ "src/backend.openapi": "../backend/openapi.ts" }`). The mapper declares `dynamicConfig`: `openProject` derives each derived document from its backend in memory, writing nothing, and returns every file the analysis read as `watchedFiles`, so an edit to one opens the project again and re-types the import. `renderImport(fileName, content)` does the same for a host with no tsconfig of its own (Vite, Node): it finds the declaring tsconfig from the document's folder up to its package root. Each name maps into the committed bytes, so a stale committed copy keeps go to definition for the names it declares. The committed file's only writer is [`@sdk-it/nx`](../nx/README.md)'s `openapi-sync`, which reads the same declarations through the exported `DerivedDocument` (`declaredBy(tsconfig)`, `at(path)`, `derive()`). See [Import your own backend](../../docs/recipes/import-openapi-document.md#import-your-own-backend).

## Other content mappers

| package                                                                    | maps                                                               | built on            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| `@vue/content-mapper`                                                      | `.vue`                                                             | Volar language core |
| `@astrojs/ts-content-mapper`                                               | `.astro`                                                           | `vscode-jsonrpc`    |
| `@gql.tada/content-mapper`                                                 | `.graphql` (a schema file named in options, `dynamicConfig: true`) | `vscode-jsonrpc`    |
| `@tsrx/content-mapper`                                                     | `.tsrx`                                                            | its own JSON-RPC    |
| `css-modules-content-mapper`, `mdx-content-mapper`, `ember-content-mapper` | CSS modules, MDX, `.gts`/`.gjs`                                    | `vscode-jsonrpc`    |

No published content mapper reads OpenAPI (npm search, 2026-11-20). The protocol is `ts-content-mapper`'s: protocol types, the server runner, cancellation and position encodings. TypeScript 7.1 ships the `contentMappers` option and `--runExternalCode`, and no server helper.

## Limits

- A change to a file that the document references through `$ref` does not re-type the import until the document itself changes: the protocol has no per-transform dependencies, and `watchedFiles` is read only when a project opens.
- The module holds every operation of the document, so a bundle ships the whole endpoint table.
- A large document is slow to re-type. On App Store Connect (1,300 operations, a 7.6 MB JSON document that renders a 3.5 MB module), an importer opened in the editor gets its diagnostics after about 3 to 5 s, an edit to the document reaches them in about 2.5 to 5.5 s, and `tsc` checks the project in about 9 s. On Box (1.8 MB) an edit takes about 0.6 to 2.7 s (measured 2026-11-20).
- A string argument of `request('GET /pets/{petId}', …)` has no definition (TypeScript gives none for a string literal argument); the same key in a type position, `StoreEndpoints['GET /pets/{petId}']`, lands on the method key.
