# @sdk-it/typescript

<p align="center">A type-safe SDK generator that converts OpenAPI specifications into TypeScript client.</p>

## Description

This package transforms OpenAPI specifications into

- a fully-typed TypeScript client
- that works in Node.js, browsers, and any JavaScript runtime
- with the ability to control the structure, style, and formatting of generated code

## Installation

```bash
npm install @sdk-it/typescript
```

## Usage

### Basic SDK Generation

```typescript
import { generate } from '@sdk-it/typescript';

import spec from './openapi.json';

await generate(spec, {
  output: './client',
  name: 'MyAPI',
});
```

### Remote Spec Example

```typescript
import { generate } from '@sdk-it/typescript';

// Fetch remote OpenAPI specification
const spec = await fetch('https://api.openstatus.dev/v1/openapi').then((res) =>
  res.json(),
);

// Generate client SDK
await generate(spec, {
  output: './client',
  name: 'OpenStatus',
});
```

### Format Generated Code

You can format the generated code using the `formatCode` option. This is especially useful if you include the generated code in source control.

```typescript
import { generate } from '@sdk-it/typescript';

const spec = await fetch('https://petstore.swagger.io/v2/swagger.json').then(
  (res) => res.json(),
);

// Format generated code using Prettier
await generate(spec, {
  output: join(process.cwd(), 'node_modules/.sdk-it/client'),
  formatCode: ({ output, env }) => {
    execFile('prettier', [output, '--write'], { env: env });
  },
});
```

### Run the script

```bash
# using recent versions of node
node --experimental-strip-types ./openapi.ts

# using node < 22
npx tsx ./openapi.ts

# using bun
bun ./openapi.ts
```

- Use the generated SDK

```typescript
import { OpenStatus } from './client';

const client = new Client({
  baseUrl: 'https://api.openstatus.dev/v1/',
});

const [result, error] = await client.request('GET /status_report', {});
```

## Using with Your Favorite Frameworks

The SDK works great on its own, but you might want to native integration with your frameworks:

- [React Query](../../docs/react-query.md)
- [Angular](../../docs/angular.md)

Let us know what are you using, and we will help you integrate it.
