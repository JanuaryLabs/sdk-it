# Use SDK-IT Programmatically

SDK-IT exposes two programmatic generation paths:

- Use `loadSpec` and `generate` when the source is an OpenAPI document.
- Use `generateProject` when the source is a Hono TypeScript backend.

The OpenAPI workflow below generates into a hidden directory and registers the
result as a workspace package, so generated files stay out of your application
source tree.

## Generate from OpenAPI

Install the generator packages:

```bash
npm install --save-dev @sdk-it/spec @sdk-it/typescript
```

### 1. Generation Script

Create a script that generates the SDK to `.sdk-it/`:

```typescript
// scripts/generate-sdk.ts
import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

const spec = await loadSpec('./openapi.json');

await generate(spec, {
  output: '.sdk-it',
  mode: 'full',
  name: 'myApi',
  packageName: '@my-api/sdk',
});
```

`name` controls the generated client class name (`MyApi`). `packageName` controls the `package.json` name — this is what you'll use in import statements.

### 2. Register as Workspace

Add `.sdk-it` to your workspace configuration:

```json
// package.json
{
  "workspaces": [".sdk-it"]
}
```

Or with pnpm:

```yaml
# pnpm-workspace.yaml
packages:
  - '.sdk-it'
```

### 3. Gitignore

```gitignore
.sdk-it
```

### 4. Generate and Install

```bash
node scripts/generate-sdk.ts
npm install
```

The package manager creates a symlink: `node_modules/@my-api/sdk` -> `.sdk-it/`.

### 5. Import

```typescript
import { MyApi } from '@my-api/sdk';

const client = new MyApi({
  baseUrl: 'https://api.example.com',
});

const result = await client.request('GET /users', {});
```

## Regenerating

When your OpenAPI spec changes, re-run the generation script. No `npm install` needed after the initial setup — the symlink stays in place.

```bash
node scripts/generate-sdk.ts
```

## With Vite

The `@sdk-it/vite` plugin automates regeneration. It generates the SDK at dev server start and production build, and watches for spec changes.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

import sdkIt from '@sdk-it/vite';

export default defineConfig({
  plugins: [
    sdkIt('./openapi.json', {
      output: '.sdk-it',
      mode: 'full',
      name: 'myApi',
      packageName: '@my-api/sdk',
    }),
  ],
});
```

You still need to add `.sdk-it` to your workspace config and `.gitignore`. The initial `npm install` is also required to create the workspace symlink — run the generation script once first so `.sdk-it/package.json` exists before `npm install`.

## Generate from a TypeScript backend

`@sdk-it/cli` exports the same backend generation engine used by
`npx @sdk-it/cli generate`:

```bash
npm install --save-dev @sdk-it/cli typescript@^6.0.3
```

```typescript
// scripts/generate-sdk.ts
import { generateProject } from '@sdk-it/cli';

await generateProject({
  tsconfig: './apps/backend/tsconfig.json',
  output: './.sdk-it',
  packageName: '@my-api/sdk',
});
```

`generateProject` currently supports Hono backends. It generates and compiles an
importable workspace package. See
[Generate a client from a TypeScript backend](./backend-to-client.md) for
initialization, Vite, Prisma, and CI setup.

## Publish for another repository

Generate a compiled client with a registry package name:

```typescript
import { generateProject } from '@sdk-it/cli';

await generateProject({
  tsconfig: './apps/backend/tsconfig.json',
  output: './generated-sdk',
  packageName: '@acme/api-client',
});
```

Set the release version in `generated-sdk/package.json`, then publish the
generated directory with your normal registry tooling:

```bash
npm publish ./generated-sdk
```

Another project can then install and import it like any other package:

```bash
npm install @acme/api-client
```

```typescript
import { Client } from '@acme/api-client';
```

SDK-IT generates the client package; your release process still owns versioning
and registry authentication.
