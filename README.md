# SDK-IT

SDK-IT is a TypeScript toolkit for working with OpenAPI specifications. It provides three main capabilities:

1. **Generating type-safe client SDKs from OpenAPI specifications**
2. **Generating OpenAPI specifications from TypeScript code**
3. **RPC Client via OpenAPI specifications** (WIP)

## Core Capabilities

### 1. SDK Generation from OpenAPI

Generate client SDKs from existing OpenAPI specifications with:

- **Type Safety**: TypeScript support with accurate type definitions that match your API contracts.
- **Isomorphic Design**: Generate SDKs for Node.js, browsers, and any runtime that runs JavaScript.
- **Customizable Output**: Control the structure, style, and formatting of generated code.

### 2. OpenAPI Generation from TypeScript

SDK-IT analyzes TypeScript code to generate OpenAPI specifications. The parser examines code structure, detects framework patterns, and extracts type definitions to create API documentation. Type inference ensures API types are reflected in the generated OpenAPI schema, while response analysis creates schema definitions that match API outputs. The system works with JSDoc comments, allowing you to add OpenAPI metadata in your source code.

## Installation

```bash
# For SDK generation from OpenAPI
npm install @sdk-it/typescript

# For framework-specific SDK generation
npm install @sdk-it/hono

# For OpenAPI generation from TypeScript code
npm install @sdk-it/generic
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

### Analyzing TypeScript Code to Generate an OpenAPI Specification

You can analyze existing TypeScript code to generate an OpenAPI specification:

```typescript
import { writeFileSync } from 'fs';

import { Paths, getProgram } from '@sdk-it/core';
import { analyzeResponses } from '@sdk-it/generic';

// Create a TypeScript program from your source files
const program = getProgram('./src');
const paths = new Paths();

// Analyze the responses in your code
const responses = analyzeResponses(program, paths);

// Convert responses to OpenAPI format
const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths: responses.toPaths(),
  components: {
    schemas: responses.toSchemas(),
  },
};

// Write the OpenAPI specification to a file
writeFileSync('openapi.json', JSON.stringify(openApiSpec, null, 2));
```

### Framework-Specific Analysis: Hono

If you're using the Hono web framework, you can use the Hono-specific analyzer:

```typescript
import { writeFileSync } from 'fs';

import { Paths, getProgram } from '@sdk-it/core';
import { analyzeHonoResponses } from '@sdk-it/hono';

// Analyze Hono-specific response patterns
const program = getProgram('./src');
const paths = new Paths();
const responses = analyzeHonoResponses(program, paths);

// Generate an OpenAPI specification
const spec = {
  openapi: '3.0.0',
  info: {
    title: 'Hono API',
    version: '1.0.0',
  },
  paths: responses.toPaths(),
  components: {
    schemas: responses.toSchemas(),
  },
};

// Write the OpenAPI specification to a file
writeFileSync('hono-api.json', JSON.stringify(spec, null, 2));
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
- [ ] express
- [ ] fastify
- [ ] koa.js
- [ ] Next.js

### Frontend Framework integration

- [x] React Query
- [ ] Angular Signals

We welcome contributions to help us expand language and framework support!

## Contributing

SDK-IT is organized as a monorepo with multiple packages:

```
.
├── packages/             # Core packages of the SDK-IT toolkit
│   ├── core/             # Core functionality and utilities
│   ├── generic/          # Generic OpenAPI processing
│   ├── hono/             # Hono framework integration
│   └── typescript/       # TypeScript code generation
```

Each package serves a specific purpose:

- **core**: Provides fundamental utilities and services used by all other packages
- **typescript**: Focuses on generating TypeScript code from OpenAPI specifications (primary use case)
- **generic**: Handles generic OpenAPI schema analysis and generation from TypeScript code
- **hono**: Specializes in Hono framework integration for both SDK generation and OpenAPI generation

For more detailed information about the codebase structure and development process, see the [contributing guide](CONTRIBUTING.md).
