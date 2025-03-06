# SDK-IT

SDK-IT generates type-safe client SDKs from OpenAPI specifications and creates OpenAPI specs from TypeScript code.

## Quick Start

```typescript
import { generate } from '@sdk-it/typescript';

import spec from './openapi.json';

await generate(spec, {
  output: './client',
  name: 'MyAPI',
});
```

Use the generated SDK

```typescript
import { MyAPI } from './client';

const client = new MyAPI({
  baseUrl: 'https://api.example.com/v1',
});

const [result, error] = await client.request('GET /books', {
  authors: [1, 10],
});
```

## Installation

```bash
# For SDK generation from OpenAPI
npm install @sdk-it/typescript

# For framework-specific OpenAPI generation
npm install @sdk-it/hono

# For any sdk-it powered framework
npm install @sdk-it/generic
```

## Core Capabilities

1. **Generating type-safe client SDKs from OpenAPI specifications**
2. **Generating OpenAPI specifications from TypeScript code**
3. **TypeScript RPC Client From OpenAPI specifications.** (WIP)

### 1. SDK Generation from OpenAPI

Generate client SDKs from existing OpenAPI specifications with:

- **Type Safety**: TypeScript support with accurate type definitions that match your API contracts.
- **Isomorphic Design**: Generate SDKs for Node.js, browsers, and any JavaScript runtime.
- **Customizable Output**: Control the structure, style, and formatting of generated code.

### 2. OpenAPI Generation from TypeScript

SDK-IT analyzes TypeScript code to generate OpenAPI specifications. The parser examines code structure, detects framework patterns, and extracts type definitions to create API documentation. Type inference ensures API types are reflected in the generated OpenAPI schema, while response analysis creates schema definitions that match API outputs. The system works with JSDoc comments, allowing you to add OpenAPI metadata in your source code.

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
  name: 'MyAPI',
});
```

### Using the Generated SDK

Once generated, you can use the SDK in your application:

```typescript
import { MyAPI } from './client';

// Create a client instance
const client = new MyAPI({
  baseUrl: 'https://api.example.com/v1',
});

// Call API methods with type safety
const [result, error] = await client.request('GET /books', {
  authors: [1, 10],
});
```

### Framework-Specific SDK Generation: Hono

If you're generating an SDK for a Hono-based API:

```typescript
import { readFileSync } from 'fs';

import { generate } from '@sdk-it/typescript';

// Load your Hono-specific OpenAPI specification
const spec = JSON.parse(readFileSync('hono-api.json', 'utf-8'));

// Generate a TypeScript SDK optimized for Hono
generate(spec, {
  output: './hono-sdk',
  name: 'HonoAPI',
  framework: 'hono',
});
```

## OpenAPI Generation

SDK-IT relies on specific primitives and JSDoc tags to correctly infer each route. Consider the following example:

```typescript
import { validate } from '@sdk-it/hono';

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

### Analyzing TypeScript Code to Generate an OpenAPI Specification

You can analyze existing TypeScript code to generate an OpenAPI specification:

```typescript
import { join } from 'node:path';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

const { paths, components } = await analyze('apps/backend/tsconfig.app.json', {
  responseAnalyzer,
});

// Now you can use the generated specification to create an SDK or save it to a file

await generate(
  {
    info: {
      title: 'My API',
      version: '1.0.0',
    },
    paths,
    components,
  },
  { output: join(process.cwd(), './client') },
);
```

## Roadmap

SDK-IT is evolving to support more languages and frameworks. Here's our current roadmap:

### SDK Generation Languages

- [x] TypeScript/JavaScript
- [ ] Dart
- [ ] Python
- [ ] Go
- [ ] Rust
- [ ] C#
- [ ] Java
- [ ] PHP
- [ ] Ruby

### OpenAPI Generation Framework Support

- [x] Generic HTTP clients
- [x] Hono
- [ ] Express
- [ ] Fastify
- [ ] Koa.js
- [ ] Next.js

### Frontend Framework Integration

- [x] React Query
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
├── packages/ # Core packages of the SDK-IT toolkit
│ ├── core/ # Core functionality and utilities
│ ├── generic/ # Generic OpenAPI processing
│ ├── hono/ # Hono framework integration
│ └── typescript/ # TypeScript code generation

```

Each package serves a specific purpose:

- **core**: Provides fundamental utilities and services used by all other packages
- **typescript**: Focuses on generating TypeScript code from OpenAPI specifications (primary use case)
- **generic**: Handles generic OpenAPI schema analysis and generation from TypeScript code
- **hono**: Specializes in Hono framework integration for both SDK generation and OpenAPI generation

For more detailed information about the codebase structure and development process, see the [contributing guide](CONTRIBUTING.md).
