# Spec processing plugins

## Status

Accepted for implementation.

## Context

`@sdk-it/spec` currently converts an OpenAPI document into SDK-IT's augmented
intermediate representation inside `toIR`. That function normalizes paths,
derives operation metadata, resolves parameters, tunes requests and responses,
normalizes schemas, extracts inline schemas, infers pagination, and builds
overview documentation.

Those transformations are useful independently, but their fixed orchestration
makes it difficult to add optional processing such as example enrichment. AI
enrichment also requires asynchronous execution while `toIR` is synchronous.

## Decision

Spec processing is an ordered asynchronous pipeline. A plugin has one public
operation:

```ts
interface ProcessingPlugin {
  name: string;
  process(context: ProcessingContext): void | Promise<void>;
}
```

The processor clones the input OpenAPI document once, coerces the clone into
the baseline IR shape, and then executes plugins sequentially in array order.
Plugins mutate that working document. The original input is never mutated.

There are no lifecycle hooks, implicit dependencies, or `before`/`after`
constraints. Callers that supply a custom pipeline own its complete order.
Callers that do not supply one receive the default pipeline.

`ProcessingContext` provides:

- the working `IR` document;
- the coerced SDK generation options;
- an optional abort signal;
- accumulated diagnostics;
- a `report` function that attributes a diagnostic to the active plugin.

Diagnostics have `info`, `warning`, and `error` severities. Reporting an error
does not implicitly throw: a plugin reports recoverable document problems and
throws when it cannot produce a valid result. Callers can observe diagnostics
through `GenerateSdkConfig.onDiagnostic`.

## Default pipeline

The default pipeline preserves the current processing responsibilities in this
order:

1. `normalize-paths` converts Express-style parameters to OpenAPI paths.
2. `normalize-operation-ids` generates valid unique operation identifiers and
   derives function names.
3. `normalize-tags` sanitizes or infers tags and function groups.
4. `normalize-parameters` merges path and operation parameters and resolves
   references.
5. `normalize-responses` resolves and names response schemas, normalizes body
   content, and ensures at least one success response.
6. `normalize-request-bodies` creates input schemas and adds parameter and
   security inputs.
7. `infer-pagination` annotates supported pagination shapes when enabled.
8. `normalize-schemas` owns the behavior previously implemented by `fixSpec`.
9. When verbose expansion is enabled, `extract-inline-schemas` owns the
   behavior previously implemented by `expandSpec`.
10. `extract-overview-docs` derives documentation after operations and schemas
    are complete.
11. `canonicalize-spec` provides deterministic component-schema and property
    ordering.

Small helpers remain ordinary functions. A plugin is a public processing
boundary, not a replacement for every helper.

Each built-in plugin has one implementation file under
`packages/spec/src/lib/processing-plugins/`. The folder index only exposes the
public factories, while `create-default-processing-plugins.ts` owns their
default ordering. Plugin behavior and pipeline composition do not share a
module.

## Custom and enrichment plugins

`GenerateSdkConfig.plugins` is the exact pipeline when supplied. Individual
built-in plugin factories and `createDefaultProcessingPlugins` are public so a
caller can insert custom processing at a deliberate position:

```ts
const defaults = createDefaultProcessingPlugins(options);

plugins: [
  ...defaults.slice(0, -2),
  enrichExamples({ generate, validate }),
  ...defaults.slice(-2),
];
```

AI integrations do not belong in the base processing contract. An example
enrichment plugin accepts a provider-neutral generation function. It preserves
authored examples by default, validates generated values before assigning
them, supports cancellation, and can implement caching or concurrency outside
the core processor.

The repository currently uses AI SDK 7. Its installed API recommends
`generateText` with `Output.object({ schema })`; `generateObject` remains
available but is deprecated. AI SDK's `jsonSchema` accepts an optional
validator, so callers must either supply that validator or validate the
generated value separately through `enrichExamples.validate`. The base spec
package does not depend on AI SDK or a particular model provider.

## Traversal

`iterateOperations` yields `{ entry, operation, pathItem }` and is the shared
operation traversal primitive. `walkSchemas` traverses component and nested
schemas while guarding references and cycles. Existing callback-based
`forEachOperation` can delegate to the iterator until all current callers are
migrated; it is not a second processing system.

## Reprocessing and idempotence

The `x-sdk-augmented` boolean shortcut is replaced by processing metadata that
records the ordered plugin names and the relevant normalized processing
options. This metadata is an audit record, not a cache key: every requested
pipeline executes. A name-only shortcut could incorrectly suppress a changed
custom plugin, and function identity cannot be represented safely in the
document.

Built-in transformations must avoid duplicating derived schemas or metadata
when rerun. The integration suite verifies a real second processing pass.

## Migration sequence

1. Introduce the public async processor, diagnostics, and traversal primitives.
2. Prove ordered synchronous and asynchronous custom plugins through `toIR`.
3. Move current `toIR` responsibilities into the default plugins without
   changing generated behavior.
4. Add canonical ordering and idempotence coverage.
5. Await `toIR` in every package and integration test.
6. Remove the superseded orchestration and boolean-only shortcut.
7. Verify `@sdk-it/spec` and every affected generator and consumer package.

## Consequences

- `toIR` returns `Promise<IR>` and all consumers must await it.
- Optional network-backed enrichment is possible without making every plugin
  asynchronous internally or adding a provider dependency to `@sdk-it/spec`.
- Pipeline order is visible and testable.
- Behavior ownership moves out of a monolithic orchestration function.
- Supplying a custom pipeline is an advanced API: omitting a required default
  plugin intentionally omits that behavior.
