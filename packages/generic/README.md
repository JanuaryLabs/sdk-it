# @sdk-it/generic

<p align="center">A TypeScript analysis tool for generating OpenAPI specifications from TypeScript code</p>

Analyzes TypeScript code to generate OpenAPI specifications. Extracts route information, parameter types, and response schemas from your codebase.

## Frameworks specific integrations

- [hono](../hono/README.md)

## Installation

```bash
npm install @sdk-it/generic
```

## Usage

Consider the following example:

- Create a route using your API framework of choice with the `@openapi` tag and validate middleware.

```typescript
import z from 'zod';

import { validate } from '@sdk-it/express/runtime';

const app = express();

/**
 * @openapi getAuthor
 * @tags authors
 */
app.get(
  '/authors/:id',
  validate((payload) => ({
    id: {
      select: payload.param.id,
      against: z.string(),
    },
  })),
  async (req, res) => {
    const author = [{ name: 'John Doe' }];
    return res.json(author);
  },
);
```

- Use the generate fn to create an OpenAPI spec from your routes.

```typescript
import { join } from 'node:path';

import { analyze, responseAnalyzer } from '@sdk-it/generic';
import { generate } from '@sdk-it/typescript';

const { paths, components } = await analyze('path/to/tsconfig.json', {
  responseAnalyzer,
});

const spec = {
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
};

await writeFile(
  join(process.cwd(), 'openapi.json'),
  JSON.stringify(spec, null, 2),
);
```

> [!TIP]
> See [typescript](../typescript/README.md) to create fully functional SDKs from the generated OpenAPI specification.

### Customizing Operations

You can customize the operations as well as add more through the `onOperation` fn.

**Use file name as tag**

Assuming your project is structured like the following, where routes are grouped by representative file names:

```
apps/
  backend/
    tsconfig.app.json
    src/
      routes/
        authors.ts
```

The file name becomes the default tag for each operation. Specify a tag in JSDoc only to override this default.

```typescript
import { basename } from 'node:path';
import { camelcase } from 'stringcase';

import { analyze, responseAnalyzer } from '@sdk-it/generic';

const { paths, components } = await analyze('apps/backend/tsconfig.app.json', {
  responseAnalyzer,
  onOperation(sourceFile, method, path, operation) {
    const fileName = basename(sourceFile.split('/').at(-1), '.ts');
    return {
      [method]: {
        [path]: {
          ...operation,
          tags: [fileName],
        },
      },
    };
  },
});
```

### Customizing Type Mappings

Custom type mappings handle non-standard TypeScript types like Prisma's `Decimal`. Use the `typesMap` option in `analyze` to define your mappings.

The example below maps `Decimal` to `string`.

```typescript
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cwd } from 'node:process';

import { defaultTypesMap } from '@sdk-it/core';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';

// Define custom type mappings
const customTypeMappings = {
  Decimal: 'string',
};

const { paths, components } = await analyze('path/to/tsconfig.json', {
  responseAnalyzer,
  typesMap: {
    ...defaultTypesMap,
    Decimal: 'string',
  },
});

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
};

await writeFile('openapi.json', JSON.stringify(spec, null, 2));
```

With this, the generator maps `Decimal` properties to `string` in the OpenAPI specification.

### Referencing external schemas

By default, the analyzer only sees schemas defined inline in the validate middleware.

For instance the following route handler is perfectly valid and will be analyzed correctly.

```typescript
/**
 * @openapi getAuthor
 * @tags authors
 */
app.get(
  '/authors/:id',
  validate((payload) => ({
    id: {
      select: payload.param.id,
      against: z.string(),
    },
  })),
  async (req, res) => {
    const { id } = req.input;
    return res.json({ id, name: 'John Doe' });
  },
);
```

However, if you want to reference external schemas as shown below, you need to provide a way for the analyzer to resolve the schema.

```ts
// filename: schemas.ts
import { z } from 'zod';

export const authorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100),
});
```

```ts
import crypto from 'node:crypto';
import { z } from 'zod';

import { validate } from '@sdk-it/express/runtime';

import { authorSchema } from './schemas';

/**
 * @openapi createBook
 * @tags books
 */
app.post(
  '/books',
  validate((payload) => ({
    title: {
      select: payload.body.title,
      against: z.string().min(2).max(100),
    },
    author: {
      select: payload.body.author,
      against: authorSchema, // <-- Referencing external schema
    },
  })),
  async (req, res) => {
    const { title, author } = req.input;
    return res.json({ id: crypto.randomUUID(), title, author });
  },
);
```

The analyzer must resolve the `authorSchema` reference to generate the correct OpenAPI schema. Otherwise it will fail.

The analyzer's `imports` option lets you include additional files in the analysis.

```ts
import { join } from 'node:path';

import { analyze } from '@sdk-it/generic';

const { paths, components } = await analyze('path/to/tsconfig.json', {
  responseAnalyzer,
  imports: [
    {
      import: 'schemas',
      from: join(process.cwd(), 'path/to/schemas.ts'), // <-- Path to the file containing the external schema
    },
  ],
});
```

Now you need to update the import to namespace imports in the route handler where the `schemas` variable is used.

```ts
import * as schemas from './schemas';

/**
 * @openapi createBook
 * @tags books
 */
app.post(
  '/books',
  validate((payload) => ({
    title: {
      select: payload.body.title,
      against: z.string().min(2).max(100),
    },
    author: {
      select: payload.body.author,
      against: schemas.authorSchema,
    },
  })),
  async (req, res) => {
    const { title, author } = req.input;
    return res.json({ id: crypto.randomUUID(), title, author });
  },
);
```

### Control endpoint/operation visibility

Control endpoint visibility with the `@access` tag in JSDoc comments. For now, only `private` is supported.

```typescript
/**
 * @openapi getAuthor
 * @tags authors
 * @access private
 */
app.get('/authors/:id', async (req, res) => {
  const author = [{ name: 'John Doe' }];
  return res.json(author);
});
```

In this example, the `getAuthor` operation will be hidden from the generated OpenAPI specification.
