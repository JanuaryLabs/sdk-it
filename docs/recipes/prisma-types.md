# Prisma Types in OpenAPI Generation

Prisma generate complex types depending how complex the prisma schema is. Sometypes like `Decimal` are not natively supported in TypeScript, which can lead to issues when generating OpenAPI specifications and others like `JsonValue` are difficult to serialize. This document explains how to handle Prisma's types.

## Prisma's Decimal Type

When using Prisma, the `Decimal` type is used for high-precision numbers. To prevent precision loss in JavaScript, these values can be handled as strings. This document shows how to configure the SDK generator to map the `Decimal` type to a `string`.

The SDK generator does not have a default mapping for Prisma's `Decimal` type, potentially defaulting to `any`. This results in a loss of type safety.

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

This approach allows for handling high-precision numbers as strings across the application stack.

### Notes

- Prisma's `Decimal` type can be mapped to `string` to avoid precision loss in JavaScript.
- The `analyze` function can be customized with a `typesMap` to change type mappings.
- Use the `createDeriver` option in the `analyze` function to provide the custom mappings during SDK generation.

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

With this configuration, Prisma's `Json` type is properly represented in the OpenAPI specification with a comprehensive schema that describes all possible JSON value types. The schema is split into three interconnected definitions:

1. **`JsonValue`**: The main type that can be any valid JSON value (primitive types, objects, or arrays)
2. **`JsonObject`**: Represents JSON objects with properties that can be any `JsonValue`
3. **`JsonArray`**: Represents JSON arrays with items that can be any `JsonValue`

This recursive structure allows for proper representation of nested JSON data while maintaining type safety.

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

- Prisma's `Json` type is mapped to the `JsonValue` schema in OpenAPI, which uses `oneOf` to represent the union of all possible JSON value types
- `JsonObject` and `JsonArray` are separate schema definitions that reference `JsonValue`, creating a recursive type structure
- This approach properly handles deeply nested JSON structures while maintaining type safety
- Mapping to `#/components/schemas/JsonValue` creates a reusable schema reference
- This approach provides clear API documentation for consumers of your OpenAPI specification

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

- The `imports` option tells the analyzer where to find external type definitions during OpenAPI generation
- In your route handlers, use the standard named imports: `import { $Enums, Prisma } from '@prisma/client';`
- Access enum values directly with `$Enums.EnumName` (e.g., `$Enums.ProductStatus`)
- Access Prisma types with `Prisma.TypeName`.
- The paths in the `imports` configuration should point to the compiled output files (`.js` or `.d.ts`), not the source files unless you're using a runtime that supports TypeScript directly (node 22+ or Bun).
- If using a monorepo with custom Prisma output, adjust the paths to match your project structure
- This approach works for any external type definitions, not just Prisma types
- Make sure the Prisma client is generated (`npx prisma generate`) before running the OpenAPI generation script
