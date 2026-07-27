# @sdk-it/vite

Generate a TypeScript SDK during Vite development and builds.

## Install

```bash
npm install --save-dev @sdk-it/vite @sdk-it/spec @sdk-it/typescript
```

## Use an OpenAPI file

```typescript
import { defineConfig } from 'vite';

import sdkIt from '@sdk-it/vite';

export default defineConfig({
  plugins: [
    sdkIt('./openapi.yaml', {
      output: './src/sdk',
      name: 'Example',
      mode: 'minimal',
    }),
  ],
});
```

Relative paths are resolved from Vite's project root. Local specification
files are watched during development, and generation also runs at build
start. You can pass an OpenAPI object or a function that resolves to an
OpenAPI object or local path instead.

## Use a TypeScript backend project

First initialize the SDK-IT project workflow:

```bash
npx @sdk-it/cli@latest init
```

Then add the plugin without an OpenAPI argument:

```typescript
import { defineConfig } from 'vite';

import sdkIt from '@sdk-it/vite';

export default defineConfig({
  plugins: [sdkIt()],
});
```

Project mode loads the SDK-IT project config and uses the same generation
path as the CLI. Install `@sdk-it/cli` alongside the plugin for this mode.
Pass `sdkIt({ config: 'config/sdk-it.ts' })` to use a non-default config
location.
