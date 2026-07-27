# Spec processing plugins

## Status

Implemented in `@sdk-it/spec`.

## Public entry points

`toIR` is the normal generator entry point:

```typescript
import { toIR } from '@sdk-it/spec';

const ir = await toIR({ spec });
```

It returns `Promise<IR>` and uses the default processing pipeline unless
`GenerateSdkConfig.plugins` is supplied. A supplied plugin array is the
complete pipeline; SDK-IT does not append missing defaults.

`processSpec` exposes both the processed document and diagnostics:

```typescript
import { createDefaultProcessingPlugins, processSpec } from '@sdk-it/spec';

const { spec: ir, diagnostics } = await processSpec({
  spec,
  plugins: createDefaultProcessingPlugins(),
});
```

## Plugin contract

```typescript
interface ProcessingPlugin {
  name: string;
  process(context: ProcessingContext): void | Promise<void>;
}

interface ProcessingContext {
  spec: IR;
  options: ProcessingOptions;
  diagnostics: ProcessingDiagnostic[];
  signal?: AbortSignal;
  report(
    diagnostic: Omit<ProcessingDiagnostic, 'plugin'>,
  ): ProcessingDiagnostic;
}
```

`processSpec`:

1. clones the input OpenAPI document with `structuredClone`;
2. coerces the clone into SDK-IT's baseline `IR` shape;
3. awaits each plugin sequentially in array order;
4. records the completed plugin names and normalized processing configuration
   in `x-sdk-processing`.

The original OpenAPI object is not mutated. The abort signal is checked before
processing, before and after every plugin, and is also available to plugins
for long-running work.

`context.report` attributes a diagnostic to the active plugin, stores it in
the result, and forwards it to `onDiagnostic` when provided. Reporting an
`error` does not throw automatically; a plugin throws when processing cannot
continue.

## Default pipeline

`createDefaultProcessingPlugins()` returns this order:

1. `normalize-paths` converts colon parameters such as `/users/:id` to OpenAPI
   paths and rejects collisions.
2. `normalize-operation-ids` creates identifier-safe, unique operation IDs and
   derives function names.
3. `normalize-tags` sanitizes or infers operation tags and function groups.
4. `normalize-parameters` merges path-level and operation-level parameters,
   with operation parameters taking precedence.
5. `normalize-responses` resolves and names response schemas and adds a
   default success response when none exists.
6. `normalize-request-bodies` creates request schemas and incorporates
   parameters and security inputs.
7. `infer-pagination` adds or removes pagination metadata according to the
   normalized pagination options.
8. `normalize-schemas` applies SDK-IT's schema normalization.
9. `extract-inline-schemas` runs only when
   `createDefaultProcessingPlugins({ verbose: true })` is used.
10. `extract-overview-docs` derives overview documentation after operations
    and schemas are complete.
11. `canonicalize-spec` sorts component schemas and schema properties
    deterministically.

Each built-in plugin has one implementation file under
`packages/spec/src/lib/processing-plugins/`.
`create-default-processing-plugins.ts` owns the default ordering, and the
folder index exports the public factories.

## Compose a custom pipeline

Built-in factories are public, so callers can place a custom plugin at an
explicit point:

```typescript
import {
  type ProcessingPlugin,
  createDefaultProcessingPlugins,
  toIR,
} from '@sdk-it/spec';

const addSource: ProcessingPlugin = {
  name: 'add-source',
  process({ spec }) {
    spec.info.description ??= 'Generated from the backend project';
  },
};

const defaults = createDefaultProcessingPlugins();

const ir = await toIR({
  spec,
  plugins: [...defaults.slice(0, -2), addSource, ...defaults.slice(-2)],
});
```

This places the custom plugin immediately before overview extraction and
canonicalization. Omitting a required built-in plugin intentionally omits that
behavior.

## Example enrichment

`enrichExamples` is provider-neutral. Its caller supplies:

- `generate(input)`, which returns a candidate value;
- `validate(input)`, which accepts or rejects that value;
- optional `overwrite`, which defaults to preserving authored examples;
- optional `name`, which sets the processing-plugin name.

It processes request and response media types sequentially, respects the abort
signal, reports generated or rejected values, and does not add an AI-provider
dependency to `@sdk-it/spec`.

## Traversal

`iterateOperations` yields `{ entry, operation, pathItem }` for each operation.
`forEachOperation` delegates to that iterator for callback-based callers.

`walkSchemas` traverses component and nested schemas, emits JSON pointers, and
guards references and object cycles.

## Reprocessing and metadata

After a successful run, the IR contains:

```typescript
{
  'x-sdk-processing': {
    plugins: ['normalize-paths', 'normalize-operation-ids'],
    configuration: '{"pagination":...,"responses":...}',
  },
}
```

This metadata is an audit record, not a cache key. Every requested pipeline
runs, including a custom pipeline whose plugin names match a previous run.
Built-in plugins are covered by an integration test that processes a real
document twice and expects the same IR.
