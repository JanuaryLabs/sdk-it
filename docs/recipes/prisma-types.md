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

## Prisma's JsonValue Type

Prisma's `JsonValue` type represents JSON data that can be any valid JSON value (string, number, boolean, null, object, or array). When generating OpenAPI specifications, this type needs special handling to properly represent its flexible nature.

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

To handle `JsonValue` properly, you can map it to a custom OpenAPI schema reference and define the schema in your OpenAPI specification:

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
        type: 'object',
        additionalProperties: {
          oneOf: [
            { type: 'string' },
            { type: 'number' },
            { type: 'boolean' },
            { type: 'null' },
            { type: 'object' },
            {
              type: 'array',
              items: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                  { type: 'object' },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

await generate(spec, {
  output: './generated-sdk',
});
```

### Result

With this configuration, the `JsonValue` type is properly represented in the OpenAPI specification with a comprehensive schema that describes all possible JSON value types. The generated SDK will have proper type definitions for handling JSON data.

For an API endpoint that returns a `User` with metadata, the generated type definition would reference the JsonValue schema:

```typescript
// In your generated SDK
export type User = {
  id: string;
  name: string;
  metadata: JsonValue | null;
};
```

### Notes

- The `JsonValue` schema uses `oneOf` to represent the union of all possible JSON value types
- Mapping to `#/components/schemas/JsonValue` creates a reusable schema reference
- The schema definition allows for nested objects and arrays while maintaining type safety
- This approach provides clear API documentation for consumers of your OpenAPI specification
