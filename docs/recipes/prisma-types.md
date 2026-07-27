# Prisma types

SDK-IT's project generator detects Prisma and configures the analyzer for its
generated types. Use that preset before maintaining type mappings by hand.

## Use the project preset

Generate the Prisma client before SDK-IT:

```bash
npx prisma generate
npx @sdk-it/cli generate
```

The default `auto` preset scans the TypeScript project for named imports of
`Prisma` or `$Enums`, including imports from a custom generated-client path. If
the import resolves, SDK-IT:

- makes the imported Prisma namespaces available while evaluating validators;
- maps `Decimal` to `string` so high-precision values are not sent as lossy
  JavaScript numbers.

The route must import the bindings it uses:

```typescript
import { $Enums, Prisma } from '@prisma/client';
```

`auto` is the default, but it can be written explicitly in
`sdk-it.config.ts`:

```typescript
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './apps/backend/tsconfig.json',
  preset: 'auto',
});
```

Use `prisma` when Prisma support is required:

```typescript
export default defineConfig({
  tsconfig: './apps/backend/tsconfig.json',
  preset: 'prisma',
});
```

This mode fails generation if SDK-IT cannot resolve a Prisma client import.
Use `none` only when the project intentionally owns all Prisma mappings:

```typescript
export default defineConfig({
  tsconfig: './apps/backend/tsconfig.json',
  preset: 'none',
});
```

The same option is available through the programmatic API:

```typescript
import { generateProject } from '@sdk-it/cli';

await generateProject({
  tsconfig: './apps/backend/tsconfig.json',
  preset: 'prisma',
});
```

See [Generate a client from a TypeScript backend](./backend-to-client.md) for
the complete project-generation workflow.

## Advanced manual mapping

Use the lower-level analyzer only when the preset cannot express a custom wire
format. This example keeps `Decimal` as a string and maps Prisma's `JsonValue`
to explicit recursive OpenAPI schemas:

```typescript
import { createRequire } from 'node:module';

import { defaultTypesMap } from '@sdk-it/core';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

const require = createRequire(import.meta.url);
const prismaClient = require.resolve('@prisma/client');

const { paths, components } = await analyze('./tsconfig.json', {
  responseAnalyzer,
  typesMap: {
    ...defaultTypesMap,
    Decimal: 'string',
    JsonValue: '#/components/schemas/JsonValue',
  },
  imports: [
    {
      import: 'Prisma',
      from: prismaClient,
      property: 'Prisma',
    },
    {
      import: '$Enums',
      from: prismaClient,
      property: '$Enums',
    },
  ],
});

const spec: Parameters<typeof generate>[0] = {
  openapi: '3.1.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components: {
    ...components,
    schemas: {
      ...components.schemas,
      JsonValue: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { $ref: '#/components/schemas/JsonObject' },
          { $ref: '#/components/schemas/JsonArray' },
        ],
      },
      JsonObject: {
        type: 'object',
        additionalProperties: {
          $ref: '#/components/schemas/JsonValue',
        },
      },
      JsonArray: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/JsonValue',
        },
      },
    },
  },
};

await generate(spec, {
  output: './generated-sdk',
  name: 'Client',
});
```

For a custom Prisma output, resolve its module instead:

```typescript
const prismaClient = require.resolve('./generated/prisma/client.ts');
```

The `import` name must match the local identifier used by route validators. If
a route imports `Prisma as DbPrisma`, inject `DbPrisma` with
`property: 'Prisma'`.
