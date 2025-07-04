# Map Prisma Decimal to String

When using Prisma, the `Decimal` type is used for high-precision numbers. To prevent precision loss in JavaScript, these values can be handled as strings. This document shows how to configure the SDK generator to map the `Decimal` type to a `string`.

The SDK generator does not have a default mapping for Prisma's `Decimal` type, potentially defaulting to `any`. This results in a loss of type safety.

### Prisma Schema

The following Prisma model contains a `Decimal` field.

```prisma
// schema.prisma

model Product {
  id    String  @id @default(cuid())
  name  String
  price Decimal @db.Decimal(10, 2)
}
```

Running `prisma generate` creates a `Product` type where `price` is of type `Prisma.Decimal`.

### SDK Generation Script

The SDK generation script can be configured to pass custom `typesMap` to the `analyze` function. This allows mapping the `Prisma.Decimal` type to a `string`.

```typescript
import { analyze, ts } from '@sdk-gen/core';
import { generate } from '@sdk-gen/typescript';
import { writeFile } from 'fs/promises';

const { paths, components } = await analyze('./tsconfig.json', {
  typesMap: {
    ...ts.defaultTypesMap,
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
