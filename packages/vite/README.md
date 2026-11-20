# @sdk-it/vite

Generate a TypeScript SDK during Vite development and builds.

## Install

```bash
npm install --save-dev @sdk-it/vite @sdk-it/spec @sdk-it/typescript
```

## Import an OpenAPI document

`sdkIt.imports()` serves an imported OpenAPI document as its SDK, with no SDK on disk:

```ts
// vite.config.ts
import sdkIt from '@sdk-it/vite';

export default { plugins: [sdkIt.imports()] };
```

```ts
import { createStore, store } from './store.openapi.yaml';

const pet = await store.request('GET /pets/{petId}', { petId: 'p1' });
```

It handles imports that end with `.openapi.yaml`, and `.openapi` for a JSON document. `@sdk-it/content-mapper` renders the module, the same way it gives the import its types in `tsc` and the editor (see its README for the tsconfig `contentMappers` entry), so the types and the running code come from one render. The module's id is the document's path with `.ts` added, so Vite strips its types, in dev and in a build. An edit to the document, or to a file it references through `$ref`, reloads the module. A document referenced over http(s) is read each time the module loads, and is not watched. A document that does not render fails the import with its first diagnostic, at its line and column.

On App Store Connect (1,300 operations, a 3.5 MB module) a dev reload takes about 2 to 4 s. Vite 8.3's dev server holds about 30 MB more after each server-side (`ssrLoadModule`) reload of that module, as it does for a plain `.ts` file of the same size. [Import an OpenAPI document as a module](../../docs/recipes/import-openapi-document.md) sets up the types and Node too.

## Use an OpenAPI file

```typescript
import { defineConfig } from 'vite';

import sdkIt from '@sdk-it/vite';

export default defineConfig({
  plugins: [
    sdkIt.file('./openapi.yaml', {
      output: './src/sdk',
      name: 'Example',
      packageName: '@acme/example-client',
      mode: 'minimal',
    }),
  ],
});
```

The settings are the options of `generate` from `@sdk-it/typescript`, so `name`
and `packageName` are required.

Relative paths are resolved from Vite's project root. Generation runs at build
start. During development, the plugin watches the specification file and each
local file that it refers to through `$ref`. When one of these files changes,
the plugin generates the SDK again. You can pass an OpenAPI object or a
function that resolves to an OpenAPI object or local path instead.

## Use a TypeScript backend project

First initialize the SDK-IT project workflow. Name the client and point the
initializer at the backend's tsconfig:

```bash
npx @sdk-it/cli@latest init --name Backend --project ./apps/backend/tsconfig.json
```

Then add the plugin without an OpenAPI argument:

```typescript
import { defineConfig } from 'vite';

import sdkIt from '@sdk-it/vite';

export default defineConfig({
  plugins: [sdkIt.project({})],
});
```

Project mode loads the SDK-IT project config and uses the same generation
path as the CLI. Install `@sdk-it/cli` alongside the plugin for this mode.
Pass `sdkIt.project({ config: 'config/sdk-it.ts' })` to use a non-default config
location.
