# @sdk-it/hono

Hono framework integration for SDK-IT that provides type-safe request validation and semantic response handling.

To learn more about SDK code generation, see the [TypeScript Doc](../typescript/readme.md)

## Installation

```bash
npm install @sdk-it/{hono,generic}
```

## Runtime Primitives

You can use these functions without the SDK-IT code generation tools, they're completely separate and functional on their own.

### Validator Middleware

The validator middleware offers type-safe request validation using [Zod](https://github.com/colinhacks/zod) schemas. It automatically validates incoming requests against your defined schemas and provides typed inputs to your handlers.

> [!IMPORTANT]
> For openapi generation to work correctly, you must use the `validate` middleware for each route.

**Basic Usage:**

```typescript
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

app.post(
  '/books',
  // No content type specified - validation runs regardless of content type
  validate((payload) => ({
    // Query parameter validation
    page: {
      select: payload.query.page,
      against: z.number().min(1).default(1),
    },

    // Multiple query parameters (array)
    categories: {
      select: payload.queries.category,
      against: z.array(z.string()),
    },

    // Body property validation
    title: {
      select: payload.body.title,
      against: z.string().min(1),
    },

    author: {
      select: payload.body.author,
      against: z.string().min(1),
    },

    // For nested objects in body
    metadata: {
      select: payload.body.metadata,
      against: z.object({
        isbn: z.string(),
        publishedYear: z.number(),
      }),
    },

    // URL parameter validation
    userId: {
      select: payload.params.userId,
      against: z.string().uuid(),
    },

    // Header validation
    apiKey: {
      select: payload.headers['x-api-key'],
      against: z.string().min(32),
    },
  })),
  (c) => {
    // TypeScript knows the shape of all inputs
    const { page, categories, title, author, metadata, userId, apiKey } =
      c.var.input;
    return c.json({ success: true });
  },
);
```

**Enforcing Content Type:**

The `validate` function can optionally enforce a specific content type before validation.

```typescript
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

// Specifying content type enforcement
app.post(
  '/users',
  validate('application/json', (payload) => ({
    // <-- Enforces 'application/json'
    name: {
      select: payload.body.name,
      against: z.string(),
    },
  })),
  (c) => {
    // Handle request with guaranteed JSON content
    const { name } = c.var.input;
    return c.json({ success: true });
  },
);
```

**Handling File Uploads (`multipart/form-data`):**

Use `z.instanceof(File)` to validate file uploads when enforcing `multipart/form-data`.

```typescript
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

// import { writeFile } from 'node:fs/promises'; // Example for saving file

/**
 * @openapi uploadProfilePicture
 * @tags users
 */
app.post(
  '/users/:userId/avatar',
  validate('multipart/form-data', (payload) => ({
    userId: {
      select: payload.params.userId,
      against: z.string().uuid(),
    },
    // File validation
    avatar: {
      select: payload.body.avatar, // 'avatar' is the field name in the form data
      against: z.instanceof(File), // <-- Validate that 'avatar' is a File object
    },
    // Other form fields can also be validated
    caption: {
      select: payload.body.caption,
      against: z.string().optional(), // Example: optional caption field
    },
  })),
  async (c) => {
    const { userId, avatar, caption } = c.var.input;

    // Example: Process the uploaded file
    // const fileBuffer = Buffer.from(await avatar.arrayBuffer());
    // await writeFile(`./uploads/${userId}_${avatar.name}`, fileBuffer);

    console.log(
      `Received avatar for user ${userId}: ${avatar.name}, size: ${avatar.size}`,
    );
    if (caption) {
      console.log(`Caption: ${caption}`);
    }
    return c.json({
      message: `Avatar for user ${userId} uploaded successfully.`,
    });
  },
);
```

### Content Type Consumption

If you only need to enforce a content type without performing validation, use the `consume` middleware:

```typescript
import { consume } from '@sdk-it/hono/runtime';

app.post(
  '/upload',
  consume('multipart/form-data'), // <-- Enforces 'multipart/form-data'
  async (c) => {
    // Process raw multipart form data from the request body
    const body = await c.req.parseBody();
    const file = body['file']; // Access file data
    // ... process file ...
    return c.json({ success: true });
  },
);
```

### Response Helper

The output function provides a clean API for sending HTTP responses with proper status codes and content types.

The `output` utility builds on hono's `context.body`.

> [!NOTE]
> You don't necessarily need to use this function for OpenAPI generation, but it provides a clean and consistent way to send responses.

```typescript
import { createOutput } from '@sdk-it/hono/runtime';

app.post('/users', (c) => {
  const output = createOutput(() => c);

  // Success responses
  return output.ok({ data: 'success' });
  return output.accepted({ status: 'processing' });

  // Error responses
  return output.badRequest({ error: 'Invalid input' });
  return output.unauthorized({ error: 'Not authenticated' });
  return output.forbidden({ error: 'Not authorized' });
  return output.notImplemented({ error: 'Coming soon' });

  // Redirects
  return output.redirect('/new-location');

  // Custom headers
  return output.ok({ data: 'success' }, { 'Cache-Control': 'max-age=3600' });
});
```

## OpenAPI Generation

SDK-IT relies on the `validator` middleware and JSDoc to correctly infer each route specification.

Consider the following example:

- Create hono routes with the `@openapi` tag and validate middleware.

```typescript
import { z } from 'zod';

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
    const { author } = c.var.input; // <-- Access validated input
    const books = [{ name: `Books by ${author}` }];
    return c.json(books);
  },
);
```

> [!TIP]
> Instead of using `createOutput` fn, you can use [context-storage](https://hono.dev/docs/middleware/builtin/context-storage) middleware and then import the global `output` object from `@sdk-it/hono/runtime`.

- Use the generate fn to create an OpenAPI spec from your routes.

<b><small>filename: openapi.ts</small></b>

```typescript
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { analyze } from '@sdk-it/generic';
// Use responseAnalyzer from `@sdk-it/hono`
// only if you use hono context object to send response
// e.g. c.json({ data: 'success' });
import { responseAnalyzer } from '@sdk-it/hono';
// Use responseAnalyzer from `@sdk-it/generic`
// only if you use the output function to send response
// e.g. output.ok({ data: 'success' });
// import { responseAnalyzer } from '@sdk-it/generic';

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

// Save the spec to a file
await writeFile('openapi.json', JSON.stringify(spec, null, 2));
// OR

// Continue to generate an SDK
await generate(spec, {
  output: join(process.cwd(), './client'),
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

<details>
<summary> Run in watch mode </summary>

```bash
node --experimental-strip-types --watch-path ./apps/backend/src --watch ./openapi.ts
```

</details>

> [!TIP]
> See [the typescript package](../typescript/README.md) for more info.

- Use the client

```typescript
import { Client } from './client';

const client = new Client({
  baseUrl: 'http://localhost:3000',
});

const [books, error] = await client.request('GET /books', {
  author: 'John Doe',
});

// Check for errors
if (error) {
  console.error('Error fetching books:', error);
} else {
  console.log('Books retrieved:', books);
}
```
