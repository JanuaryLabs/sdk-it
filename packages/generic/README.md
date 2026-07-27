# @sdk-it/generic

<p align="center">Analyze TypeScript routes and produce an OpenAPI document</p>

`@sdk-it/generic` extracts routes, validation schemas, and responses from a
TypeScript project. Framework packages provide the runtime middleware and
response analyzer.

## Framework integrations

- [Hono](../hono/README.md)

## Installation

For a Hono project:

```bash
npm install @sdk-it/hono hono zod
npm install --save-dev @sdk-it/core @sdk-it/generic typescript@^6.0.3
```

## Analyze a Hono project

Define routes with `validate` and an `@openapi` JSDoc tag:

```typescript
// src/app.ts
import { Hono } from 'hono';
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/**
 * @openapi getAuthor
 * @tags authors
 */
app.get(
  '/authors/:id',
  validate((payload) => ({
    id: {
      select: payload.params.id,
      against: z.string(),
    },
  })),
  (c) => {
    const { id } = c.var.input;
    return c.json({ id, name: 'John Doe' });
  },
);
```

Analyze the TypeScript project and write the resulting OpenAPI document:

```typescript
// openapi.ts
import { writeFile } from 'node:fs/promises';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

const { paths, components, tags } = await analyze('./tsconfig.json', {
  responseAnalyzer,
});

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
  tags: tags.map((name) => ({ name })),
};

await writeFile('openapi.json', JSON.stringify(spec, null, 2));
```

Run the script with Node.js 24 or newer:

```bash
node openapi.ts
```

See [`@sdk-it/typescript`](../typescript/README.md) to generate a client from
the OpenAPI document.

## Customize operations

`onOperation` receives every derived operation. This example uses the route
file name as its tag:

```typescript
import { basename } from 'node:path';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

const { paths, components } = await analyze(
  './apps/backend/tsconfig.app.json',
  {
    responseAnalyzer,
    onOperation(sourceFile, _method, _path, operation) {
      operation.tags = [basename(sourceFile, '.ts')];
      return {};
    },
  },
);
```

## Customize type mappings

Use `typesMap` for TypeScript types without a direct OpenAPI representation.
For example, map Prisma's `Decimal` to a string so it keeps its precision on
the wire:

```typescript
import { defaultTypesMap } from '@sdk-it/core';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

const { paths, components } = await analyze('./tsconfig.json', {
  responseAnalyzer,
  typesMap: {
    ...defaultTypesMap,
    Decimal: 'string',
  },
});
```

## Reference external schemas

The analyzer can evaluate inline Zod schemas directly:

```typescript
against: z.string().min(2).max(100);
```

When a validator references a schema from another file, use a namespace import
in the route:

```typescript
// src/schemas.ts
import { z } from 'zod';

export const authorSchema = z.object({
  id: z.uuid(),
  name: z.string().min(2).max(100),
});
```

```typescript
// src/app.ts
import { Hono } from 'hono';
import crypto from 'node:crypto';
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

import * as schemas from './schemas.ts';

const app = new Hono();

app.post(
  '/books',
  validate('application/json', (payload) => ({
    title: {
      select: payload.body.title,
      against: z.string().min(2).max(100),
    },
    author: {
      select: payload.body.author,
      against: schemas.authorSchema,
    },
  })),
  (c) => {
    const { title, author } = c.var.input;
    return c.json({ id: crypto.randomUUID(), title, author }, 201);
  },
);
```

Then inject that namespace when analyzing the project:

```typescript
import { fileURLToPath } from 'node:url';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

const { paths, components } = await analyze('./tsconfig.json', {
  responseAnalyzer,
  imports: [
    {
      import: 'schemas',
      from: fileURLToPath(new URL('./src/schemas.ts', import.meta.url)),
    },
  ],
});
```

The injected file must be loadable by the Node.js process running the
analyzer.

## Hide an operation

Add `@access private` to exclude a route from the generated OpenAPI document:

```typescript
/**
 * @openapi getAuthor
 * @tags authors
 * @access private
 */
app.get(
  '/authors/:id',
  validate((payload) => ({
    id: {
      select: payload.params.id,
      against: z.string(),
    },
  })),
  (c) => c.json({ id: c.var.input.id, name: 'John Doe' }),
);
```
