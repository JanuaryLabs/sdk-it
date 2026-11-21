> **Design for review.** The words of `@sdk-it/openapi` (backlog #5158).

# Glossary

**Analysis.** What `@sdk-it/generic`'s `analyze()` finds in a backend's program: the paths, each operation's inputs and responses, and the components those use.

**Base document.** The part of an OpenAPI document that code cannot tell: `openapi`, `info`, `servers`, `security`, tag objects, security schemes and any components written by hand. It has no `paths`.

**Definition.** An `OpenApiDefinition`: the backend tsconfig, the base document, the type mappings, the middleware security rules and the transformers. A backend default-exports one from a module, by convention `openapi.ts` beside its tsconfig.

**Derived document.** An OpenAPI document that an app imports (`./backend.openapi`) and that every reader produces from a definition instead of reading it as written. The app's tsconfig names its definition: `"derived": { "src/backend.openapi": "../backend/openapi.ts" }`.

**Document transformer.** A function that changes the merged document in place, after every operation transformer has run.

**Middleware security rule.** A middleware, named by its export and its file, and the security requirements of each route it guards.

**Operation transformer.** A function that changes one operation in place, after the analysis builds it and before the merge.

**Prisma preset.** What the package does when a route file imports `Prisma` or `$Enums` by name: those imports are allowed in an `against`, `Decimal` maps to a string, and a missing client fails with `PrismaClientNotGeneratedError`.

**Reader.** A host that turns a derived document into a module: the content mapper (types), `sdkIt.imports()` (Vite) and the Node register hook.

**Source files.** Every file of the backend's program outside `node_modules`. A change to one can change the document, so a reader watches them.

**Type mapping.** A TypeScript type name and the JSON Schema that the analysis writes in its place.
