> **Design for review.** This is the API of `@sdk-it/openapi` on paper. No code exists yet. Each decision has an ADR in [adr/](adr/); the words are in [CONTEXT.md](CONTEXT.md). Backlog #5158.

# @sdk-it/openapi

Produces the OpenAPI document of a TypeScript backend from its code. `@sdk-it/spec` loads a document; this package writes one.

The backend says, in one TypeScript module, what its code cannot tell: the document's `info`, its servers and security schemes, its tag descriptions, and the transformers it wants. The analysis finds the routes, their inputs and their responses.

```ts
// apps/backend/openapi.ts
import { defineOpenApi } from '@sdk-it/openapi';

export default defineOpenApi({
  tsconfig: new URL('./tsconfig.app.json', import.meta.url),
  document: {
    openapi: '3.1.0',
    info: { title: 'Meddit API', version: '1.0.0' },
  },
});
```

Three hosts read this module:

- `sdk-it generate` writes a client package from it.
- The content mapper, `sdkIt.imports()` and the Node register hook serve it as a module to an app that imports the backend's document (`import { createBackend } from './backend.openapi'`).
- Any script calls `generateDocument` itself.

## Produce a document

```ts
import { generateDocument } from '@sdk-it/openapi';

import definition from './openapi.ts';

const { document, sourceFiles } = await generateDocument(definition);
// document: the OpenAPI document
// sourceFiles: every file of the backend's program outside node_modules; a change to one can change the document
```

`generateDocument` writes nothing. Writing the document, watching `sourceFiles` and rendering a client are the host's job.

## Describe what the code cannot tell

`document` is a base document. The analysis merges what it finds into it:

- `paths` come from the analysis only. A base document has no `paths`.
- `components.schemas` and `components.responses` hold both. Writing the same key in the base and in the analysis is an error (`ComponentConflictError`).
- `tags`: each tag an operation names gets a tag object. A tag object in the base keeps its fields (`description`, `x-*`).
- Everything else is the base's: `openapi`, `info`, `servers`, `security`, `externalDocs`, `components.securitySchemes`.

`openapi` and `info` are required. The package invents no title and no version.

```ts
document: {
  openapi: '3.1.0',
  info: { title: 'Agent API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  security: [{ bearer: [] }],
  tags: [{ name: 'users', description: 'User management.' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: { ApiError: { type: 'object', properties: { message: { type: 'string' } } } },
  },
},
```

## Map a type to a schema

```ts
types: {
  UIMessage: { type: 'object' },
},
```

When the analysis meets a type of that name, it writes that schema in its place. `types` is added onto the defaults (streams and binary arrays as `{}`, `DateConstructor` as `{ type: 'string' }`). The Prisma preset adds `Decimal: { type: 'string' }`.

## Mark routes with their security

```ts
middlewareSecurity: [
  {
    middleware: { import: 'authenticate', from: new URL('./src/middlewares/auth.ts', import.meta.url) },
    security: [{ bearer: [] }],
  },
],
```

Each route that a matching middleware guards gets that `security`. A route that no rule matches gets `security: []`, which means public.

## Transform operations and the document

```ts
transformers: {
  operation: [
    (operation, { method, path }) => {
      if (path.startsWith('/admin')) operation.tags = ['admin'];
    },
  ],
  document: [
    (document) => {
      document.info.description = 'Generated from the backend.';
    },
  ],
},
```

Operation transformers run once for each operation, in the order given, after the analysis has built it. Document transformers then run once, in the order given, on the merged document. A transformer changes its argument in place, may be `async`, and returns nothing.

## Prisma

When a route file imports `Prisma` or `$Enums` from a Prisma client by name, the Prisma preset applies:

- An `against` may read those two imports.
- `Decimal` maps to `{ type: 'string' }`.
- A client that is not generated fails with `PrismaClientNotGeneratedError`.

Prisma's `JsonValue` and `JsonObject` need nothing: the analysis writes them as recursive components.

`allowedNamedImports` names more imports that an `against` may read, such as a second Prisma client imported under another name:

```ts
allowedNamedImports: ['CentralPrisma'],
```

## Signatures

```ts
export function defineOpenApi(definition: OpenApiDefinition): OpenApiDefinition;
export function generateDocument(
  definition: OpenApiDefinition,
): Promise<GeneratedDocument>;

export interface OpenApiDefinition {
  tsconfig: URL;
  document: BaseDocument;
  types?: Readonly<Record<string, SchemaObject>>;
  allowedNamedImports?: readonly string[];
  middlewareSecurity?: readonly MiddlewareSecurityRule[];
  transformers?: {
    operation?: readonly OperationTransformer[];
    document?: readonly DocumentTransformer[];
  };
}

/** An OpenAPI 3.1 or 3.2 document without `paths`; `openapi` and `info` are required. */
export type BaseDocument = Omit<OpenAPIObject, 'paths'>;

export interface MiddlewareSecurityRule {
  middleware: { import: string; from: URL };
  security: SecurityRequirementObject[];
  values?: { scheme: string; argument: number; mode: 'any' | 'all' };
}

export type OperationTransformer = (
  operation: OperationObject,
  context: { method: HttpMethod; path: string; document: OpenAPIObject },
) => void | Promise<void>;

export type DocumentTransformer = (
  document: OpenAPIObject,
) => void | Promise<void>;

export interface GeneratedDocument {
  document: OpenAPIObject;
  sourceFiles: string[];
}

export class ComponentConflictError extends Error {
  readonly section: 'schemas' | 'responses';
  readonly key: string;
}

export class PrismaClientNotGeneratedError extends Error {
  readonly routeFile: string;
  readonly importName: string;
}
```

## What happens on each call

| You call                       | Underneath                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateDocument(definition)` | `openAnalysisProject(fileURLToPath(tsconfig))` from `@sdk-it/core` opens the backend's program                                                            |
|                                | the Prisma preset applies when a route file imports `Prisma` or `$Enums` by name                                                                          |
|                                | `analyze(project, { responseAnalyzer, types, allowedNamedImports, middlewareSecurity })` from `@sdk-it/generic`, with `@sdk-it/hono`'s `responseAnalyzer` |
|                                | each operation transformer runs on each operation                                                                                                         |
|                                | the analysis is merged into `document`                                                                                                                    |
|                                | each document transformer runs on the merged document                                                                                                     |
|                                | `sourceFiles` is the program's files outside `node_modules`, workspace packages read as source included                                                   |

## Errors

| Error                                     | When                                                                       | The caller's next step                                              |
| ----------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `PrismaClientNotGeneratedError`           | a route file imports `Prisma` or `$Enums`, and the client does not load    | run the Prisma client's generate target                             |
| `ComponentConflictError`                  | the base document and the analysis both write `components.<section>.<key>` | rename one of them                                                  |
| `UnresolvedTypeError` (`@sdk-it/core`)    | a response type does not resolve                                           | fix the type; the error names the route and the response's position |
| `UnloadedImportError` (`@sdk-it/generic`) | another named import an `against` reads does not load                      | fix the import                                                      |

## The same concepts in other systems

| System                                            | Same concept                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| .NET `Microsoft.AspNetCore.OpenApi`               | `AddOpenApi(options => …)` builds the app's document from its endpoints. Operation and document transformers (`AddOperationTransformer`, `AddDocumentTransformer`) run in the order added, operations first. |
| .NET `Microsoft.Extensions.ApiDescription.Server` | generates the document at build time                                                                                                                                                                         |
| Go huma                                           | `huma.OpenAPI` is built from registered operations; `config.Components.SecuritySchemes` holds the schemes                                                                                                    |
| `hono-openapi`                                    | `generateSpecs(app, { documentation })`: a base document merged into the generated one                                                                                                                       |

## Why not a package from npm

Requirement: document a Hono route as written, `router.get(path, validate(...), handler)`, with the response type read from what the handler returns, and no annotation on the route.

| Package             | Version (2026-11-21) | Weekly downloads | Result on that route                                                        |
| ------------------- | -------------------- | ---------------- | --------------------------------------------------------------------------- |
| `hono-openapi`      | 1.6.0                | 4.4M             | `"paths": {}`: it documents only routes that `describeRoute(...)` annotates |
| `@hono/zod-openapi` | 1.6.3                | 5.0M             | `"paths": {}`: it documents only routes that `createRoute(...)` declares    |

Node 26 has no built-in that produces an OpenAPI document. The `@stdlib` scope has none.

## Who uses what

| Consumer                                         | Uses                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@sdk-it/cli`                                    | `generateDocument`; `defineConfig({ openapi, name, packageName })` takes an `OpenApiDefinition`                 |
| `@sdk-it/content-mapper`                         | `generateDocument` for a derived document: it watches `sourceFiles`, renders the client and writes the document |
| `@sdk-it/vite` `sdkIt.imports()`                 | the same, through content-mapper's `DerivedDocument`                                                            |
| 15 hand-written `openapi.ts` scripts in 13 repos | replaced by an `openapi.ts` that calls `defineOpenApi`; one migration backlog item per repo                     |
