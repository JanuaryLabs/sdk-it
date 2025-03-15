# SDK-IT

<div align="center">

SDK-IT generates type-safe client SDKs from OpenAPI specifications and creates OpenAPI specs from TypeScript code.

</div>

## Features

1. **Generating type-safe client SDKs from OpenAPI specifications to different languages**

Also

2. Generating OpenAPI specifications from TypeScript code

3. TypeScript RPC Client From OpenAPI specifications. (WIP)

## Installation

```bash
# For SDK generation from OpenAPI
npm install @sdk-it/typescript

# For framework-specific OpenAPI generation
npm install @sdk-it/hono

# For any sdk-it powered framework
npm install @sdk-it/generic
```

## Quick Start

- Generate an SDK from an OpenAPI specification

<small>filename: openapi.ts</small>

```typescript
import { generate } from '@sdk-it/typescript';

import spec from './openapi.json';

await generate(spec, {
  output: './client',
  name: 'MyAPI',
});
```

- Run the script

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
import { MyAPI } from './client';

const client = new MyAPI({
  baseUrl: 'https://api.example.com/v1',
});

const [result, error] = await client.request('GET /books', {
  authors: [1, 10],
});
```

## SDK Generation

### Generating an SDK from an OpenAPI Specification

The most common use case is generating a TypeScript SDK from an OpenAPI specification:

```typescript
import { generate } from '@sdk-it/typescript';

// Load your OpenAPI specification
import spec from './openapi.json';

// Generate the SDK
await generate(spec, {
  output: './client',
  name: 'Client',
});
```

### Using the Generated SDK

Once generated, you can use the SDK in your application:

```typescript
import { Client } from './client';

// Create a client instance
const client = new Client({
  baseUrl: 'https://api.example.com/v1',
});

// Call API methods with type safety
const [result, error] = await client.request('GET /books', {
  authors: [1, 10],
});
```

## OpenAPI Generation

### 2. OpenAPI Generation from TypeScript

With the right framework integration, SDK-IT can statically examine your codebase and generate OpenAPI specifications with minimal input required.

- Extracts TypeScript types for request/response schemas
- Uses framework-specific adapters to detect API patterns
- Requires little to no additional configuration or annotations; depends on your code structure and naming conventions

The result is accurate OpenAPI documentation that stays in sync with your code.

- API Routes

```typescript
import { validate } from '@sdk-it/hono/runtime';

const app = new Hono();

/**
 * @openapi listBooks
 * @tags books
 */
app.get(
  '/books',
  validate((payload) => ({
    author: {
      select: payload.query.author,
      against: z.string(),
    },
  })),
  async (c) => {
    const books = [{ name: 'OpenAPI' }];
    return c.json(books);
  },
);
```

This route will be correctly inferred because it uses the validate middleware.

- Analyze adapter

```typescript
import { join } from 'node:path';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

const { paths, components } = await analyze('apps/backend/tsconfig.app.json', {
  responseAnalyzer,
});

// Now you can use the generated specification to create an SDK or save it to a file
const spec = {
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
};
await generate(spec, {
  output: join(process.cwd(), './client'),
});
```

## Roadmap

SDK-IT is evolving to support more languages and frameworks. Here's our current roadmap:

### SDK Generation Languages

- [x] TypeScript/JavaScript
- [ ] Dart
- [ ] Python
- [ ] Go
- [ ] Rust
- ...

### OpenAPI Generation Framework Support

- [x] [Generic HTTP clients](./packages/generic/README.md)
- [x] [Hono](./packages/hono/README.md)
- [ ] Express
- [ ] Fastify
- [ ] Koa.js
- [ ] Next.js

### Frontend Framework Integration

- [x] [React Query](./docs/react-query.md)
- [ ] Angular Signals

We welcome contributions to help us expand language and framework support!

## Third-Party API Integration

Generate type-safe client SDKs for third-party services that provide OpenAPI specifications.

```typescript
import { join } from 'node:path';

import { generate } from '@sdk-it/typescript';

// Fetch the OpenAPI specification from a third-party service
const spec = await fetch('https://api.openstatus.dev/v1/openapi').then((res) =>
  res.json(),
);

// Pass it to the generate fn and specify where do you want to save the code
await generate(spec, {
  output: join(process.cwd(), './client'),
});
```

Then use the generated client in your application:

```typescript
import { Client } from './client';

const client = new Client({
  baseUrl: 'https://api.openstatus.dev/v1/',
});

const [result, error] = await client.request('GET /status_report', {});
```

Violla!

![demo](./demo.png)

## Contributing

SDK-IT is organized as a monorepo with multiple packages:

```
.
├── packages/
│   ├── core/             # Core functionality and utilities
│   ├── cli/              # Command-line interface
│   ├── generic/          # Generic OpenAPI generation
│   ├── hono/             # Hono OpenAPI generation
│   └── typescript/       # TypeScript code generation
```

Each package serves a specific purpose:

- **core**: Provides fundamental utilities and services used by all other packages
- **cli**: Command-line interface for SDK-IT
- **typescript**: Focuses on generating TypeScript code from OpenAPI specifications (primary use case)
- **generic**: OpenAPI generation using `output` and `validate` constructs.
- **hono**: OpenAPI generation for the Hono framework

For more detailed information about the codebase structure and development process, see the [contributing guide](CONTRIBUTING.md).
