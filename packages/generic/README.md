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
npm install --save-dev @sdk-it/core @sdk-it/generic
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

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

using project = openAnalysisProject('./tsconfig.json');
const { paths, components, tags } = await analyze(project, {
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

The project owns a native TypeScript process. `using` disposes the project when
the scope ends.

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

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

using project = openAnalysisProject('./apps/backend/tsconfig.app.json');
const { paths, components } = await analyze(project, {
  responseAnalyzer,
  onOperation(sourceFile, _method, _path, operation) {
    operation.tags = [basename(sourceFile, '.ts')];
    return {};
  },
});
```

## Customize type mappings

Use `typesMap` for TypeScript types without a direct OpenAPI representation.
For example, map Prisma's `Decimal` to a string so it keeps its precision on
the wire:

```typescript
import { defaultTypesMap } from '@sdk-it/core/deriver.js';
import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

using project = openAnalysisProject('./tsconfig.json');
const { paths, components } = await analyze(project, {
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

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

using project = openAnalysisProject('./tsconfig.json');
const { paths, components } = await analyze(project, {
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

## Name recursive schemas

A Zod schema with `.meta({ id })` becomes the component
`#/components/schemas/<id>`, and every reference to it points there. A
recursive schema must have an id, because an unnamed cycle cannot become a
component. `z.json()` is recursive, so name it:

```typescript
const jsonValue = z.json().meta({ id: 'JsonValue' });

app.post(
  '/shortcuts',
  validate((payload) => ({
    integrations: {
      select: payload.body.integrations,
      against: z.record(z.string(), jsonValue),
    },
  })),
  (c) => c.json({ ok: true }),
);
```

Without the id, analysis fails with
`POST /shortcuts body field integrations: A recursive schema has no name; give it .meta({ id }) so it becomes a named component.`
Give one id to one schema only: the same id on two different schemas also
fails analysis. The generated TypeScript client and `@sdk-it/rpc` validate the
named component recursively.

## Derive operation security from middleware

Declare each OpenAPI security scheme once, then associate authentication and
authorization middleware by its exported symbol and source file:

```typescript
import { fileURLToPath } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

const authModule = fileURLToPath(new URL('./src/auth.ts', import.meta.url));

using project = openAnalysisProject('./tsconfig.json');
const { paths, components } = await analyze(project, {
  responseAnalyzer,
  securitySchemes: {
    bearer: { type: 'http', scheme: 'bearer' },
  },
  middlewareSecurity: [
    {
      middleware: { import: 'authenticate', from: authModule },
      security: [{ bearer: [] }],
    },
    {
      middleware: { import: 'authorise', from: authModule },
      security: [{ bearer: [] }],
      values: { scheme: 'bearer', argument: 0, mode: 'any' },
    },
  ],
});
```

The analyzer resolves imported symbols, so local import aliases do not change
the mapping. `mode: 'any'` emits one OpenAPI alternative per statically known
argument value; `mode: 'all'` keeps every value in one requirement. Multiple
matched middleware are combined as an OpenAPI AND requirement. A route with no
matched security middleware receives `security: []`. Dynamic values fail
analysis because they cannot be represented accurately in the generated
document.

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
