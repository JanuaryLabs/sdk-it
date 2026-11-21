# Operation and document transformers replace onOperation

Status: proposed

## Context

`analyze()`'s `onOperation(sourceFile, method, path, operation)` returns a `PathsObject`. `Paths` merges it with `Object.assign` at the path level (`core/src/lib/paths.ts:424-431`), so returning anything for a path replaces every other method already on it. All 15 scripts mutate `operation` in place and return `{}`.

.NET's `Microsoft.AspNetCore.OpenApi` has operation transformers, then document transformers, each run in the order added, each changing its argument in place.

## Decision

`transformers: { operation?: OperationTransformer[]; document?: DocumentTransformer[] }`:

- An operation transformer gets `(operation, { method, path, document })`, runs after the analysis builds the operation, and returns nothing.
- Document transformers run once on the merged document.
- Both may be `async`.

`onOperation` is deleted from `analyze()`.

## Consequences

- No return value to misuse.
- Several transformers compose in order.
- A whole-document change (pruning unused schemas, as context-compiler does) has a place.
