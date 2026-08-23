# Generate a client from a TypeScript backend

SDK-IT can analyze a Hono backend and generate an importable TypeScript client without writing an intermediate OpenAPI file into the repository.

## Install

```bash
npm install --save-dev @sdk-it/cli typescript@^6.0.3
```

Install the Vite integration only when the consuming application uses Vite:

```bash
npm install --save-dev @sdk-it/vite
```

## Initialize

Point the initializer at the backend project's TypeScript configuration:

```bash
npx @sdk-it/cli init --project ./apps/backend/tsconfig.json
```

The initializer:

- Creates `apps/backend/sdk-it.config.ts` beside the backend tsconfig.
- Creates the tracked `apps/backend/.sdk-it/package.json` workspace stub.
- Ignores the generated workspace except for that stub.
- Registers the explicit `apps/backend/.sdk-it` workspace path.
- Preserves existing ignore and workspace entries.

If the workspace package is named `@acme/platform`, the generated config is:

```ts
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
  packageName: '@acme/backend-client',
});
```

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
import { Client } from '@acme/backend-client';

const api = new Client({
  baseUrl: '/api',
});

const books = await api.request('GET /books', {});
```

Runtime exports point to JavaScript under `dist`; Node.js does not need to execute TypeScript from `node_modules`.

## Programmatic generation

The CLI package also exposes the generation API without starting the command-line interface:

```ts
import { generateProject } from '@sdk-it/cli';

await generateProject({
  tsconfig: './apps/backend/tsconfig.json',
});
```

The programmatic defaults are:

| Option        | Default          |
| ------------- | ---------------- |
| `output`      | `./.sdk-it`      |
| `packageName` | `@sdk-it/client` |
| `framework`   | auto-detected    |
| `preset`      | `auto`           |

`init --project` instead derives a unique package name from the workspace scope
and backend directory.

## Vite

The Vite plugin loads the same `sdk-it.config.ts` and delegates to the CLI generation API:

```ts
import { defineConfig } from 'vite';

import sdkIt from '@sdk-it/vite';

export default defineConfig({
  plugins: [sdkIt()],
});
```

It generates at development-server setup and before production builds. It does not watch backend files.

Pass a config path when Vite cannot discover the workspace config from its root:

```ts
sdkIt({
  config: '../backend/sdk-it.config.ts',
});
```

## Prisma preset

SDK-IT detects imports of `Prisma` or `$Enums` and applies Prisma type mappings. This includes custom generated-client module paths.

Force Prisma support when the project must use it:

```ts
export default defineConfig({
  tsconfig: './tsconfig.json',
  preset: 'prisma',
});
```

Forced mode fails when SDK-IT cannot find a Prisma client import. Disable detection when the project handles Prisma types itself:

```ts
export default defineConfig({
  tsconfig: './tsconfig.json',
  preset: 'none',
});
```

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
