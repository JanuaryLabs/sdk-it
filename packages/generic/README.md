# @sdk-it/generic

<p align="center">A TypeScript analysis tool for generating OpenAPI specifications from TypeScript code</p>

This package provides tools to analyze TypeScript code and generate OpenAPI specifications from it. It can extract route information, parameter types, and response schemas from your TypeScript codebase.

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

Assuming your projects structurd like the following where routes are grouped by representivie file names.

```
apps/
  backend/
    tsconfig.app.json
    src/
      routes/
        authors.ts
```

Then you can consider the file name as the tag for the operation which means you don't need to specify the tag in the JSDoc comment or only specify the tag if you want to override the default behavior.

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

The type analysis can be customized to handle types that are not standard in TypeScript, such as `Decimal` from Prisma. The `typesMap` option in the `analyze` function allows you to provide your own type mappings.

The example below shows how to map a `Decimal` type to a `string`.

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

This configuration ensures that any property with the `Decimal` type is represented as a `string` in the generated OpenAPI specification.

### Referencing external schemas

By default, the analyzer doesn't see beyond the validation schema defined in the validate middleware route handler and expects the schemas to be defined inline.

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

In this case the analyzer needs to be able to resolve the `authorSchema` reference to generate the correct OpenAPI schema otherwise it will fail.

Luckily, the analyzer provides an `imports` option that allows you to specify additional files to be included in the analysis.

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

You can control the visibility of endpoints and operations in the generated OpenAPI specification by using the `@access` tag in your JSDoc comments. for now only `private` is supported.

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
