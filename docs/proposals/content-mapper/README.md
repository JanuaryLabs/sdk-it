> **Design for review.** This is the API of `@sdk-it/content-mapper` on paper, before any code (backlog #3106, phase 3). The package does not exist yet.

# @sdk-it/content-mapper

A TypeScript 7.1 content mapper. When a TypeScript file imports an OpenAPI document, TypeScript runs this package, sends it the document's text, and gets back the SDK of that document as one TypeScript module. The import is typed in `tsc` and in the editor, and go-to-definition on a model, an endpoint or the client lands in the document.

```ts
import { type StoreEndpoints, createStore, store } from './store.openapi.yaml';

const pets = await store.request('GET /pets', { limit: 10 });
```

It gives types only. To run that import, a bundler or a loader has to load the document too: the Vite plugin (phase 4) and the Node loader (phase 5).

## Set up a project

```bash
npm install --save-dev @sdk-it/content-mapper
```

```jsonc
// tsconfig.json
{
  "compilerOptions": { "module": "nodenext" },
  "contentMappers": [
    { "package": "@sdk-it/content-mapper", "extensions": [".openapi.yaml"] },
  ],
}
```

```bash
npx tsc --runExternalCode
```

In the editor, the TypeScript 7.1 language server runs content mappers when `runExternalCode` is on in its initialization options.

The mapper takes no options. The names come from the file: `store.openapi.yaml` exports `store`, `createStore`, `StoreClient`, `StoreSettings` and `StoreEndpoints`, the same names that `generate` gives an SDK named `store`.

A JSON document needs an extension that does not end in `.json`, such as `.openapi`: TypeScript refuses a mapped extension that ends in `.json` (TS18066).

## The manifest

```jsonc
// package.json of @sdk-it/content-mapper
"typescript": {
  "contentMapper": {
    "exec": ["node", "./dist/server.js"],
    "dynamicConfig": false,
    "compilerOptions": []
  }
}
```

## What happens on each import

| TypeScript does                                                                            | the mapper does underneath                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| starts the mapper (`exec`)                                                                 | `runContentMapper` from `ts-content-mapper` answers `initialize` with UTF-16 positions and the diagnostic source `sdk-it`                                                                                       |
| sends `transform(fileName, content)`, `content` being the editor's text with unsaved edits | `parseDocument(content)` from `yaml`, keeping each node's range                                                                                                                                                 |
|                                                                                            | `new SpecLoader(Documents.standard([[fileUrl, document]])).load(fileUrl)` from `@sdk-it/spec`: files the document references through `$ref` are read from disk or http, the document itself is never read again |
|                                                                                            | `renderModule(spec, { name })` from `@sdk-it/typescript`, `name` = file name before the first `.`                                                                                                               |
|                                                                                            | each span of the module → the range of its key in the YAML (`paths./pets.get` → the `get` key)                                                                                                                  |
| gets `{ text, extension: '.ts', mappings, diagnostics }`                                   | a span whose location is not in this file (a schema from another file) has no mapping                                                                                                                           |

Mappings are navigation only: definition, type definition, references, hover and document highlights. A rename never edits the YAML.

## Diagnostics

Each diagnostic is shown in the `.yaml` file, with the source `sdk-it`.

| code | when                                                                                                                        | where                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | the YAML does not parse                                                                                                     | the range the YAML parser reports, kept inside the text              |
| 2    | a `$ref` does not resolve, or a referenced document cannot be read                                                          | the `$ref` value when it is in this file, else the start of the file |
| 3    | the SDK cannot be rendered: the file name is not an identifier, a spec name clashes, a security requirement names no scheme | the start of the file                                                |

When a step fails, the module is `export {};`, so each importer sees the missing names until the document is fixed. YAML that still parses while you type keeps rendering.

## Other content mappers

| package                                                                    | maps                                                               | built on            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| `@vue/content-mapper`                                                      | `.vue`                                                             | Volar language core |
| `@astrojs/ts-content-mapper`                                               | `.astro`                                                           | `vscode-jsonrpc`    |
| `@gql.tada/content-mapper`                                                 | `.graphql` (a schema file named in options, `dynamicConfig: true`) | `vscode-jsonrpc`    |
| `@tsrx/content-mapper`                                                     | `.tsrx`                                                            | its own JSON-RPC    |
| `css-modules-content-mapper`, `mdx-content-mapper`, `ember-content-mapper` | CSS modules, MDX, `.gts`/`.gjs`                                    | `vscode-jsonrpc`    |

## Why no npm package

No published content mapper reads OpenAPI (npm search, 2026-11-20: "content-mapper", "content mapper openapi", "ts-content-mapper", "openapi typescript 7 import"). The protocol is not ours to write: `ts-content-mapper` (sxzz, 0.1.1) holds the protocol types, the server runner, cancellation and position encodings. TypeScript 7.1 itself ships the `contentMappers` option and `--runExternalCode`, and no server helper.

## Limits

- A change to a file that the document references through `$ref` does not re-type the import until the document itself changes: the protocol has no per-transform dependencies, and `watchedFiles` is read only when a project opens.
- The module holds every operation of the document: a bundle ships the whole endpoint table.
- On a 1,300-operation document an edit takes about 2.5 to 3.5 s to reach the importers (YAML parse about 0.8 s).

## Who uses what

| consumer                     | uses                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| a project's `tsc` and editor | the manifest and `contentMappers`                                |
| `@sdk-it/vite` (phase 4)     | `@sdk-it/spec` `SpecLoader` and `renderModule`, not this package |
| Node (phase 5)               | `@sdk-it/content-mapper/register`                                |
