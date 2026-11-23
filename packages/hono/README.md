# @sdk-it/hono

Hono runtime middleware and response analysis for SDK-IT.

`@sdk-it/hono/runtime` is the canonical home for the shared Hono request
validator. Import it instead of copying its implementation into an application.
See the [validator comparison and contract](../../docs/architecture/hono-validator.md)
for the consolidation decisions and consumer migration notes.

See [`@sdk-it/typescript`](../typescript/README.md) for OpenAPI-to-TypeScript
client generation.

## Installation

```bash
npm install @sdk-it/hono hono zod
npm install --save-dev @sdk-it/core @sdk-it/generic @sdk-it/typescript
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
The query string `"null"` stays a string unless a schema explicitly transforms it.
Malformed JSON throws an HTTP 400 exception with `api/invalid-json` in its cause.
Malformed content-type headers return 415 with `api/unsupported-media-type`.
Selecting a body field from JSON null, an array, or a scalar returns 400 with
`api/invalid-body`; validate these values through a whole-body schema instead.

The selector runs once per request. `c.var.input` contains Zod's parsed output,
including defaults, transformations, and optional keys.

Whole-body selection (`select: payload.body`) works at runtime, including for
array or nullable schemas. For generated OpenAPI, keep direct field selectors;
whole-body generation is not supported by the current static analyzer.

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

Repeated form fields are preserved: a single `files` field is a `File`, while
multiple `files` fields are a `File[]`. A field named `files[]` always produces
an array and is selected with `payload.body['files[]']`. The same rule applies
to repeated URL-encoded fields. Use a Zod schema matching the accepted shape.

### Parse a schema directly

`parse` supports any Zod schema, including unions, arrays, async refinements,
and transformations:

```typescript
import { parse } from '@sdk-it/hono/runtime';

const status = await parse(z.enum(['draft', 'published']), rawStatus);
```

Failed validation throws `HTTPException(400)`. Its cause contains `code`,
`detail`, `errors` grouped by field, and `formErrors` for root-level issues.
Both error collections contain entries
with `message`, `code`, and a dot-joined `path`. Applications choose how to
serialize the exception through their Hono error handler.
The singular `detail` spelling follows
[Problem Details (RFC 9457)](https://www.rfc-editor.org/rfc/rfc9457.html#section-3.1.4)
and .NET's `ProblemDetails.Detail`; the application owns the full response format.

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

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

using project = openAnalysisProject('./apps/backend/tsconfig.app.json');
const { paths, components, tags } = await analyze(project, {
  responseAnalyzer,
});

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
  name: 'MyApi',
  packageName: '@acme/my-api',
});
```

Run the script with Node.js 24 or newer:

```bash
node openapi.ts
```

The generated client returns response data and throws typed errors:

```typescript
import { Unauthorized, createMyApi } from './client/index.ts';

const client = createMyApi({
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

## Document thrown errors

A route documents what the app's `app.onError` sends for each error it can throw. The analysis takes the branch that narrows the thrown class (`if (error instanceof X)`, or a concise conditional), else the fallthrough, and binds each `error.<member>` the branch reads to the throw site:

```typescript
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message, cause: error.cause }, error.status);
  }
  return c.json({ error: 'internal' }, 500);
});

// in a handler
throw new HTTPException(400, {
  message: 'Google authorization belongs to another app',
  cause: { code: 'google/invalid-grant' },
});
```

The route documents a 400 whose `error` is the throw's message and whose `cause.code` is the const `google/invalid-grant`. A member the analysis cannot follow to the throw site is documented by its declared type. A `throw` inside `app.onError` documents nothing.

Each status is one number literal for each throw site. A status read from a table needs a table whose properties are literals:

```typescript
const statusOf = {
  not_found: 404,
  conflict: 409,
} as const satisfies Record<Code, 404 | 409>;

return c.json({ code: error.code }, statusOf[error.code]);
```

Each code the throw site can produce gets its own status. Any other status fails the analysis, naming the throw site, the handler and the fix.

An app with no `app.onError` documents Hono's default handler: an `HTTPException` is its message as `text/plain` at its status, and any other error is 500 `text/plain` `Internal Server Error`.

The analysis reads what a throw carries from its construction: `HTTPException`'s status and its `message`, `cause` and `res` options, and the constructor of an error class the program reads as source. A program registers one `app.onError`; a second fails the analysis.

### evlog error catalogs

A route can throw an [evlog](https://www.npmjs.com/package/evlog) catalog error:

```typescript
import { defineErrorCatalog } from 'evlog';

export const billingErrors = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: { status: 402, message: 'Card declined' },
});

// in a handler
throw billingErrors.PAYMENT_DECLINED();
```

`responseAnalyzer` reads each catalog throw with no preset: its `code`, and its `status`, `message`, `why`, `fix` and `link` from the call's options or else the catalog entry. An entry with no status is evlog's 500. The throw is documented as the app's `app.onError` sends it:

```typescript
app.onError((error, c) => {
  if (error instanceof EvlogError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  throw error;
});
```

The route documents a 402 whose `error` is `Card declined` and whose `code` is the entry's code. With no `app.onError`, a catalog throw is Hono's default 500 `text/plain`, since an `EvlogError` has no `getResponse`.
