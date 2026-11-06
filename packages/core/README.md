# @sdk-it/core

Low-level TypeScript analysis, OpenAPI reference, schema, and file utilities
used by SDK-IT analyzers and generators.

Most applications should start with
[`@sdk-it/cli`](../cli/README.md), [`@sdk-it/spec`](../spec/README.md), or a
language generator. Use `@sdk-it/core` when building an analyzer or extending
the generation pipeline.

## Install

```bash
npm install @sdk-it/core zod@^4.6.7 openapi3-ts
```

The `@sdk-it/core/program.js` and `@sdk-it/core/deriver.js` subpaths use the
TypeScript 7.1 compiler. To use them, also install it under the
`@typescript/native` name:

```bash
npm install @typescript/native@npm:typescript@7.1.0-beta
```

Schema analysis requires Zod 4.3 or later within major version 4. Imported schemas
must also use Zod 4, including nested schemas. Separate compatible Zod 4 package
instances are supported; Zod 3 runtimes and schemas receive a migration error.

## Open a TypeScript project

```typescript
import { openAnalysisProject, sourceFiles } from '@sdk-it/core/program.js';

using project = openAnalysisProject('./tsconfig.json');

for (const sourceFile of sourceFiles(project.program)) {
  console.log(sourceFile.fileName);
}
```

`project.checker` is the type checker of the program. The project owns a native
TypeScript process. `using` disposes the project when the scope ends.

## Resolve an OpenAPI reference

```typescript
import { resolveRef } from '@sdk-it/core';

const schema = resolveRef(openapi, openapi.components!.schemas!.User!);
```

The root export includes route analysis, OpenAPI reference helpers, and Zod
schema evaluation, and it never loads the TypeScript compiler. The helpers that
need the compiler live in subpaths: `@sdk-it/core/program.js` (analysis projects
and programs) and `@sdk-it/core/deriver.js` (type derivation). Other
lower-level modules are available the same way, such as
`@sdk-it/core/file-system.js` and `@sdk-it/core/paths.js`.
