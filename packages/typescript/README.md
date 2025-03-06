# @sdk-it/typescript

<p align="center">A type-safe SDK generator that converts OpenAPI specifications into TypeScript client.</p>

## Description

This package transforms OpenAPI specifications into fully-typed TypeScript client libraries. It focuses on generating clean, organized code that works in any JavaScript environment.

## Installation

```bash
npm install @sdk-it/typescript
```

## Usage Examples

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
const spec = await fetch('https://petstore.swagger.io/v2/swagger.json').then(
  (res) => res.json(),
);

// Generate client SDK
await generate(spec, {
  output: './client',
  name: 'PetStore',
});
```
