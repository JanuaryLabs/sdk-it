# @sdk-it/hono

Hono runtime middleware and response analysis for SDK-IT.

See [`@sdk-it/typescript`](../typescript/README.md) for OpenAPI-to-TypeScript
client generation.

## Installation

```bash
npm install @sdk-it/hono hono zod
npm install --save-dev @sdk-it/generic @sdk-it/typescript typescript@^6.0.3
```

## Runtime primitives

The runtime exports work without generating an SDK.

### Validate requests

Every route included in OpenAPI generation must use `validate`. The middleware
validates the selected values and exposes the parsed result as `c.var.input`.

```typescript
import { Hono } from 'hono';
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

const app = new Hono();

app.post(
  '/users/:userId/books',
  validate('application/json', (payload) => ({
    userId: {
      select: payload.params.userId,
      against: z.uuid(),
    },
    page: {
      select: payload.query.page,
      against: z.coerce.number().int().min(1).default(1),
    },
    categories: {
      select: payload.queries.category,
      against: z.array(z.string()),
    },
    apiKey: {
      select: payload.headers['x-api-key'],
      against: z.string().min(32),
    },
    title: {
      select: payload.body.title,
      against: z.string().min(1),
    },
    metadata: {
      select: payload.body.metadata,
      against: z.object({
        isbn: z.string(),
        publishedYear: z.number().int(),
      }),
    },
  })),
  (c) => {
    const { userId, page, categories, apiKey, title, metadata } = c.var.input;
    return c.json({ userId, page, categories, apiKey, title, metadata }, 201);
  },
);
```

The optional first argument enforces the request content type before
validation:

```typescript
validate('application/json', (payload) => ({
  name: {
    select: payload.body.name,
    against: z.string(),
  },
}));
```

Supported enforced content types are:

- `application/json`
- `application/x-www-form-urlencoded`
- `multipart/form-data`
- `text/plain`

Query and path values arrive as strings. Use Zod coercion when the parsed value
should be a number, boolean, or another non-string type.

### Validate file uploads

Use `z.instanceof(File)` with `multipart/form-data`:

```typescript
app.post(
  '/users/:userId/avatar',
  validate('multipart/form-data', (payload) => ({
    userId: {
      select: payload.params.userId,
      against: z.uuid(),
    },
    avatar: {
      select: payload.body.avatar,
      against: z.instanceof(File),
    },
    caption: {
      select: payload.body.caption,
      against: z.string().optional(),
    },
  })),
  (c) => {
    const { userId, avatar, caption } = c.var.input;
    return c.json({
      userId,
      filename: avatar.name,
      size: avatar.size,
      caption,
    });
  },
);
```

### Enforce a content type without validation

Use `consume` when a route only needs content-type enforcement:

```typescript
import { consume } from '@sdk-it/hono/runtime';

app.post('/upload', consume('multipart/form-data'), async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  return c.json({ uploaded: file instanceof File });
});
```

### Send semantic responses

`createOutput` wraps Hono's response methods:

```typescript
import { createOutput } from '@sdk-it/hono/runtime';

app.post('/users', (c) => {
  const output = createOutput(() => c);
  return output.created('/users/123', { id: '123' });
});
```

The helper provides methods for common success and error statuses, redirects,
attachments, and custom headers. It is a runtime utility; use Hono response
methods such as `c.json` on analyzed routes so `responseAnalyzer` can infer
their response bodies and status codes.

## Generate OpenAPI and a client

Create an analyzed route:

```typescript
// src/app.ts
import { Hono } from 'hono';
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

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
  (c) => {
    const { author } = c.var.input;
    return c.json([{ title: 'Example', author }]);
  },
);
```

Analyze the backend and generate the client:

```typescript
// openapi.ts
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

const { paths, components, tags } = await analyze(
  './apps/backend/tsconfig.app.json',
  {
    responseAnalyzer,
  },
);

const spec = {
  openapi: '3.1.0' as const,
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
  tags: tags.map((name) => ({ name })),
};

await writeFile('openapi.json', JSON.stringify(spec, null, 2));
await generate(spec, {
  output: resolve('client'),
  name: 'Client',
});
```

Run the script with Node.js 24 or newer:

```bash
node openapi.ts
```

The generated client returns response data and throws typed errors:

```typescript
import { Client, Unauthorized } from './client/index.ts';

const client = new Client({
  baseUrl: 'http://localhost:3000',
});

try {
  const books = await client.request('GET /books', {
    author: 'John Doe',
  });
  console.log(books);
} catch (error) {
  if (error instanceof Unauthorized) {
    console.error('Authentication is required', error.data);
  } else {
    throw error;
  }
}
```
