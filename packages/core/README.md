# @sdk-it/core

Low-level TypeScript analysis, OpenAPI reference, schema, and file utilities
used by SDK-IT analyzers and generators.

Most applications should start with
[`@sdk-it/cli`](../cli/README.md), [`@sdk-it/spec`](../spec/README.md), or a
language generator. Use `@sdk-it/core` when building an analyzer or extending
the generation pipeline.

## Install

```bash
npm install @sdk-it/core typescript openapi3-ts
```

## Create a TypeScript program

```typescript
import { getProgram } from '@sdk-it/core';

const program = getProgram('./tsconfig.json');
const checker = program.getTypeChecker();

for (const sourceFile of program.getSourceFiles()) {
  if (!sourceFile.isDeclarationFile) {
    console.log(sourceFile.fileName);
  }
}
```

## Resolve an OpenAPI reference

```typescript
import { resolveRef } from '@sdk-it/core';

const schema = resolveRef(openapi, openapi.components!.schemas!.User!);
```

The root export includes TypeScript program helpers, type derivation, route
analysis, OpenAPI reference helpers, and Zod schema evaluation. Lower-level
modules are also available through subpaths such as
`@sdk-it/core/file-system.js` and `@sdk-it/core/paths.js`.
