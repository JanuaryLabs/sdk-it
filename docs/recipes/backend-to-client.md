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

- Creates `sdk-it.config.ts`.
- Adds `.sdk-it/` to `.gitignore`.
- Registers `.sdk-it` as a workspace package.
- Preserves existing ignore and workspace entries.

The generated config contains the backend path:

```ts
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './apps/backend/tsconfig.json',
});
```

## Generate

Generate the client, then let the package manager create the workspace link:

```bash
npx @sdk-it/cli generate
npm install
```

SDK-IT writes the client to `.sdk-it`:

```text
.sdk-it/
  package.json
  src/
  dist/
    index.js
    index.d.ts
```

Application code imports the generated package normally:

```ts
import { Client } from '@sdk-it/client';

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

The defaults are:

| Option        | Default          |
| ------------- | ---------------- |
| `output`      | `./.sdk-it`      |
| `packageName` | `@sdk-it/client` |
| `framework`   | auto-detected    |
| `preset`      | `auto`           |

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
  config: '../../sdk-it.config.ts',
});
```

## Prisma preset

SDK-IT detects imports of `Prisma` or `$Enums` and applies Prisma type mappings. This includes custom generated-client module paths.

Force Prisma support when the project must use it:

```ts
export default defineConfig({
  tsconfig: './apps/backend/tsconfig.json',
  preset: 'prisma',
});
```

Forced mode fails when SDK-IT cannot find a Prisma client import. Disable detection when the project handles Prisma types itself:

```ts
export default defineConfig({
  tsconfig: './apps/backend/tsconfig.json',
  preset: 'none',
});
```

## Fresh clones and CI

`.sdk-it` is ignored, so generate it before type checking or building:

```json
{
  "scripts": {
    "sdk:generate": "npx @sdk-it/cli generate",
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
