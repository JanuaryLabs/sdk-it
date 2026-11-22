# Prisma types

`@sdk-it/openapi` detects Prisma and configures the analyzer for its generated
types. Use that preset before maintaining type mappings by hand.

## Use the project preset

Generate the Prisma client before SDK-IT. In an Nx or other task graph, the
`sdk-it generate` target depends on the Prisma client's generate target:

```bash
npx prisma generate
npx @sdk-it/cli generate
```

The preset applies whenever the TypeScript project has a named import of
`Prisma` or `$Enums`, including imports from a custom generated-client path or
a workspace package that re-exports the client. For each one, SDK-IT:

- lets the route's validators read the imported binding, so an `against`
  reads Prisma's enums, the single source of truth for their values (the
  analyzer passes `allowedNamedImports: ['$Enums', 'Prisma']`);
- maps `Decimal` to `string` so high-precision values are not sent as lossy
  JavaScript numbers.

The route must import the bindings it uses:

```typescript
import { $Enums, Prisma } from '@prisma/client';

app.post(
  '/patients',
  validate('application/json', (payload) => ({
    sex: { select: payload.body.sex, against: z.enum($Enums.Sex) },
  })),
  (c) => c.json({ sex: c.var.input.sex }),
);
```

SDK-IT resolves each binding an `against` reads from its route file, as
Node.js resolves an ES module import with the tsconfig's `customConditions`,
and loads it before it evaluates any validator. When the client is not
generated, generation fails, naming the route file, the import and the cause,
with TypeScript's error for the missing module:

```text
src/patients.route.ts imports $Enums from '@acme/db', which an against reads, but it does not load: Cannot find module '…/generated/prisma/client.js' …
TypeScript reports:
…: error TS2307: Cannot find module './generated/prisma/client.js' or its corresponding type declarations.
Run the Prisma client's generate target (prisma generate).
```

Any other named import in an `against` fails analysis: write the schema inline
or import it as a namespace (`import * as inputs`). A response typed by a
client that was not generated fails generation, naming the module TypeScript
cannot find.

There is no option to turn the preset on or off: an `against` that reads `$Enums` needs it, and a backend without such an import is unaffected. A client that does not load fails with `PrismaClientNotGeneratedError`, whose `routeFile` and `importName` name the route and the import. Other named imports an `against` may read go in the definition's `allowedNamedImports`, such as a second client imported under another name:

```typescript
import { defineOpenApi } from '@sdk-it/openapi';

export default defineOpenApi({
  tsconfig: new URL('./tsconfig.json', import.meta.url),
  document: { openapi: '3.1.0', info: { title: 'Backend', version: '1.0.0' } },
  allowedNamedImports: ['CentralPrisma'],
});
```

See [Generate a client from a TypeScript backend](./backend-to-client.md) for
the complete project-generation workflow.

## Advanced manual mapping

Use the lower-level analyzer only when the preset cannot express a custom wire
format. This example keeps `Decimal` as a string and maps Prisma's `JsonValue`
to explicit recursive OpenAPI schemas:

```typescript
import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

using project = openAnalysisProject('./tsconfig.json');
const { paths, components } = await analyze(project, {
  responseAnalyzer,
  types: {
    Decimal: { type: 'string' },
    JsonValue: { $ref: '#/components/schemas/JsonValue' },
  },
  allowedNamedImports: ['$Enums', 'Prisma'],
});

const spec: Parameters<typeof generate>[0] = {
  openapi: '3.1.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components: {
    ...components,
    schemas: {
      ...components.schemas,
      JsonValue: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { $ref: '#/components/schemas/JsonObject' },
          { $ref: '#/components/schemas/JsonArray' },
        ],
      },
      JsonObject: {
        type: 'object',
        additionalProperties: {
          $ref: '#/components/schemas/JsonValue',
        },
      },
      JsonArray: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/JsonValue',
        },
      },
    },
  },
};

await generate(spec, {
  output: './generated-sdk',
  name: 'Backend',
  packageName: '@acme/backend-client',
});
```

The route imports `$Enums` and `Prisma` from `@prisma/client` or from a custom
output, and `analyze` resolves that import from the route file. An alias such
as `import { Prisma as DbPrisma }` is allowed: `allowedNamedImports` names the
export, not the local name.

A workspace package that re-exports the client and that the tsconfig reads
from source through `customConditions` is loaded from source too. Its files
import each other by their `.ts` extension, because Node.js does not map a
`.js` specifier to a `.ts` file.
