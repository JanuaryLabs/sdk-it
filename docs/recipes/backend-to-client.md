# Generate a client from a TypeScript backend

SDK-IT can analyze a Hono backend and generate an importable TypeScript client without writing an intermediate OpenAPI file into the repository.

## Install

```bash
npm install --save-dev @sdk-it/cli
```

Install the Vite integration only when the consuming application uses Vite:

```bash
npm install --save-dev @sdk-it/vite
```

## Initialize

Point the initializer at the backend project's TypeScript configuration, and
name the client:

```bash
npx @sdk-it/cli init --name Backend --project ./apps/backend/tsconfig.json
```

The initializer:

- Creates `apps/backend/openapi.ts`, the backend's OpenAPI definition (`@sdk-it/openapi`), and `apps/backend/sdk-it.config.ts`, beside the backend tsconfig.
- Creates the tracked `apps/backend/.sdk-it/package.json` workspace stub.
- Ignores the generated workspace except for that stub.
- Registers the explicit `apps/backend/.sdk-it` workspace path.
- Preserves existing ignore and workspace entries.

If the workspace package is named `@acme/platform`, the initializer writes:

```ts
// apps/backend/openapi.ts
import { defineOpenApi } from '@sdk-it/openapi';

export default defineOpenApi({
  tsconfig: new URL('./tsconfig.json', import.meta.url),
  document: {
    openapi: '3.1.0',
    info: { title: 'Backend', version: '1.0.0' },
  },
});
```

```ts
// apps/backend/sdk-it.config.ts
import { defineConfig } from '@sdk-it/cli';

import openapi from './openapi.ts';

export default defineConfig({
  openapi,
  name: 'Backend',
  packageName: '@acme/backend-client',
});
```

`openapi.ts` says how the backend's document is produced: what its code cannot tell (`info`, servers, security schemes, tag descriptions), type mappings, middleware security and transformers. See [`@sdk-it/openapi`](../../packages/openapi/README.md). The same definition serves a client package, an app that imports the backend's document as a module, and any script.

`openapi`, `name` and `packageName` are required. `name` names the generated exports:
`name: 'Backend'` exports `createBackend`. The initializer writes the `--name`
value. It refuses a name that does not become a TypeScript identifier, such as
`2024Api`.

`packageName` is the npm name of the generated package. For a backend in a
subfolder, the initializer uses the workspace scope and the backend folder
name (`@acme/backend-client`, or `backend-client` when the workspace package
has no scope). For a backend at the workspace root, it uses the workspace
package name (`@acme/platform` gives `@acme/platform-client`). The workspace
`package.json` must then set `name`.

Run the package manager once after initialization, then commit the updated root
manifest, lockfile, backend config, ignore file, and generated package stub:

```bash
npm install
```

The stub lets `npm ci` link the generated package on a fresh clone before the
first generation run.

## Generate

Generate the client through the backend's config:

```bash
npx @sdk-it/cli generate --config ./apps/backend/sdk-it.config.ts
```

SDK-IT writes the client beside the backend:

```text
apps/backend/.sdk-it/
  package.json
  src/
  dist/
    index.js
    index.d.ts
```

Application code imports the generated package normally:

```ts
import { createBackend } from '@acme/backend-client';

const api = createBackend({
  baseUrl: '/api',
});

const books = await api.request('GET /books', {});
```

The relative `baseUrl` resolves against the page location, so this works in the browser. In Node.js, pass an absolute URL. A relative `baseUrl` there makes the request reject with a `TypeError`.

Runtime exports point to JavaScript under `dist`; Node.js does not need to execute TypeScript from `node_modules`.

## Programmatic generation

The CLI package also exposes the generation API without starting the command-line interface:

```ts
import { generateProject } from '@sdk-it/cli';

import openapi from './apps/backend/openapi.ts';

await generateProject({
  openapi,
  name: 'Backend',
  packageName: '@acme/backend-client',
});
```

`openapi`, `name` and `packageName` are required. `output` defaults to `./.sdk-it` beside the config.

## Vite

The Vite plugin loads the same `sdk-it.config.ts` and delegates to the CLI generation API:

```ts
import { defineConfig } from 'vite';

import sdkIt from '@sdk-it/vite';

export default defineConfig({
  plugins: [sdkIt.project({})],
});
```

It generates at development-server setup and before production builds. It does not watch backend files.

Pass a config path when Vite cannot discover the workspace config from its root:

```ts
sdkIt.project({
  config: '../backend/sdk-it.config.ts',
});
```

## Prisma preset

When a route file imports `Prisma` or `$Enums` by name, `@sdk-it/openapi` lets an `against` read them and maps `Decimal` to a string. This includes custom generated-client module paths. A client that is not generated fails with `PrismaClientNotGeneratedError`, which says to run Prisma generate. There is no option to turn the preset on or off. See [Prisma types](./prisma-types.md).

## Fresh clones and CI

Generated sources are ignored, so generate them before type checking or building:

```json
{
  "scripts": {
    "sdk:generate": "npx @sdk-it/cli generate --config ./apps/backend/sdk-it.config.ts",
    "typecheck": "npm run sdk:generate && nx run web:typecheck",
    "build": "npm run sdk:generate && nx run web:build"
  }
}
```

Generation skips writes when the analyzed API and client settings have not changed.

## Current scope

- Hono is the supported backend framework for project analysis.
- The CLI and Vite integration generate once per command or lifecycle hook.
- Backend file watching is not included.
- The existing OpenAPI-to-SDK CLI and Vite workflows remain available.
