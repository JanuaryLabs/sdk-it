# Zero-File SDK with Workspaces

Generate your SDK into a hidden directory and use npm workspaces so it feels like a regular dependency — no generated files in your source tree.

## Setup

### 1. Generation Script

Create a script that generates the SDK to `.sdk-it/`:

```typescript
// scripts/generate-sdk.ts
import { generate } from '@sdk-it/typescript';
import { loadSpec } from '@sdk-it/spec';

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

The `@sdk-it/vite` plugin automates regeneration. It reads your OpenAPI spec, generates the SDK on dev server start and production build, and watches for spec changes during development.

```typescript
// vite.config.ts
import sdkIt from '@sdk-it/vite';
import { defineConfig } from 'vite';

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
