# Prisma Types in OpenAPI Generation

Prisma generates complex types that vary with schema complexity. Types like `Decimal` lack native TypeScript support, causing issues in OpenAPI generation. Others like `JsonValue` resist serialization. This document shows how to handle both.

## Prisma's Decimal Type

Prisma's `Decimal` type stores high-precision numbers. JavaScript loses that precision, so map `Decimal` to `string` in the SDK generator.

Without a custom mapping, the generator defaults `Decimal` to `any`, losing type safety.

### Prisma Schema

The following Prisma model contains a `Decimal` field.

```prisma
// schema.prisma

model Product {
  id    String  @id @default(cuid())
  name  String
  price Decimal
}
```

Running `prisma generate` creates a `Product` type where `price` is of type `Prisma.Decimal`.

### SDK Generation Script

The SDK generation script can be configured to pass custom `typesMap` to the `analyze` function. This allows mapping the `Prisma.Decimal` type to a `string`.

```typescript
import { analyze, ts } from '@sdk-gen/core';
import { generate } from '@sdk-gen/typescript';
import { writeFile } from 'fs/promises';

import { defaultTypesMap } from '@sdk-it/core';

const { paths, components } = await analyze('./tsconfig.json', {
  typesMap: {
    ...defaultTypesMap,
    Decimal: 'string',
  },
});

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
};

await generate(spec, {
  output: './generated-sdk',
});
```

### Result

With this configuration, any API property using the `Prisma.Decimal` type is represented as a `string` in the generated SDK.

For an API endpoint that returns a `Product`, the generated type definition for the response is as follows:

```typescript
// In your generated SDK
export type Product = {
  id: string;
  name: string;
  price: string;
};
```

High-precision numbers now travel as strings across the entire stack.

### Notes

- Map Prisma's `Decimal` to `string` to avoid JavaScript precision loss.
- Customize the `analyze` function's `typesMap` to change type mappings.
- Use the `createDeriver` option for custom mappings during generation.

## Prisma's Json Type

Prisma's `Json` type represents JSON data that can be any valid JSON value (string, number, boolean, null, object, or array). When generating OpenAPI specifications, this type needs special handling to properly represent its flexible nature.

### Prisma Schema

```prisma
// schema.prisma

model User {
  id       String            @id @default(cuid())
  name     String
  metadata Json
}
```

### SDK Generation Script

To handle Prisma's `Json` type properly, you can map it to a custom OpenAPI schema reference and define the schema in your OpenAPI specification:

```typescript
import { analyze, ts } from '@sdk-gen/core';
import { generate } from '@sdk-gen/typescript';

import { defaultTypesMap } from '@sdk-it/core';

const { paths, components } = await analyze('./tsconfig.json', {
  typesMap: {
    ...defaultTypesMap,
    Decimal: 'string',
    JsonValue: '#/components/schemas/JsonValue',
  },
});

const spec: Parameters<typeof generate>[0] = {
  openapi: '3.1.0',
  info: { title: 'Virtual Care API', version: '1.0.0' },
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
      } as const,
      JsonObject: {
        type: 'object',
        additionalProperties: { $ref: '#/components/schemas/JsonValue' },
      } as const,
      JsonArray: {
        type: 'array',
        items: { $ref: '#/components/schemas/JsonValue' },
      } as const,
    },
  },
};

await generate(spec, {
  output: './generated-sdk',
});
```

### Result

This configuration represents Prisma's `Json` type as three interconnected OpenAPI schema definitions:

1. **`JsonValue`**: The main type that can be any valid JSON value (primitive types, objects, or arrays)
2. **`JsonObject`**: Represents JSON objects with properties that can be any `JsonValue`
3. **`JsonArray`**: Represents JSON arrays with items that can be any `JsonValue`

This recursive structure preserves type safety for nested JSON data.

For an API endpoint that returns a `User` with metadata, the generated type definition would reference the JsonValue schema:

```typescript
// In your generated SDK
export type User = {
  id: string;
  name: string;
  metadata: JsonValue | null;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
```

### Notes

- Prisma's `Json` maps to a `JsonValue` OpenAPI schema using `oneOf` for all JSON value types.
- `JsonObject` and `JsonArray` reference `JsonValue` recursively.
- This handles deeply nested JSON while preserving type safety.
- `#/components/schemas/JsonValue` serves as a reusable schema reference.

## Using Prisma's $Enums and Prisma Namespace

When working with Prisma-generated types in your API routes, you'll often need to reference Prisma's `$Enums` for enum types and the model interfaces. By design, the analyzer doesn't see these types automatically. To make these available during OpenAPI generation, you need to configure the analyzer to import/see them.

### The Challenge

The analyzer needs to know where to find the Prisma types, in this case, the `$Enums` namespace and the `Prisma` namespace.

Consider this example using Prisma enums and types:

```typescript
import { $Enums } from '@prisma/client';
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

/**
 * @openapi createProduct
 * @tags products
 */
app.post(
  '/products',
  validate((payload) => ({
    name: {
      select: payload.body.name,
      against: z.string(),
    },
    status: {
      select: payload.body.status,
      against: z.nativeEnum($Enums.ProductStatus), // Using Prisma enum
    },
    price: {
      select: payload.body.price,
      against: z.string(),
    },
  })),
  async (c) => {
    const { name, status, price, metadata } = c.var.input;
    // ... create product
    return c.json({ id: '123', name, status, price, metadata });
  },
);
```

### Solution: Configure Imports

To make Prisma's generated types available to the analyzer, configure the `imports` option in your OpenAPI generation script:

```typescript
import { cwd, join } from 'node:path';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

const { paths, components } = await analyze('path/to/tsconfig.json', {
  responseAnalyzer,
  typesMap: {
    ...defaultTypesMap,
    Decimal: 'string',
    JsonValue: '#/components/schemas/JsonValue',
  },
  imports: [
    {
      import: 'Prisma',
      from: join(cwd(), 'node_modules/.prisma/client/index.js'),
    },
    {
      import: '$Enums',
      from: join(cwd(), 'node_modules/.prisma/client/index.js'),
    },
  ],
});

const spec = {
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
      ... // JsonValue, JsonObject, JsonArray as before
    },
  },
};

// Store the spec or generate the SDK
```

### Custom Prisma Output Location

If you've configured Prisma to output types to a custom location, adjust the paths accordingly:

```typescript
import { cwd, join } from 'node:path';

const { paths, components } = await analyze('path/to/tsconfig.json', {
  responseAnalyzer,
  typesMap: {
    ...defaultTypesMap,
    Decimal: 'string',
    JsonValue: '#/components/schemas/JsonValue',
  },
  imports: [
    {
      import: 'Prisma',
      from: join(cwd(), 'packages/db/dist/index.js'),
    },
    {
      import: '$Enums',
      from: join(cwd(), 'packages/db/dist/index.js'),
    },
  ],
});
```

### Notes

- The `imports` option tells the analyzer where to find external type definitions.
- In route handlers, import normally: `import { $Enums, Prisma } from '@prisma/client';`
- Access enums as `$Enums.EnumName` and types as `Prisma.TypeName`.
- Point `imports` paths to compiled files (`.js` or `.d.ts`), not source files -- unless your runtime handles TypeScript directly (Node 22+, Bun).
- In monorepos with custom Prisma output, adjust paths to match your structure.
- This works for any external type definitions, not just Prisma.
- Run `npx prisma generate` before running the OpenAPI generation script.
