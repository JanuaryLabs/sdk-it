# Type mappings are JSON Schema objects added onto the defaults

Status: accepted (user, 2026-11-21: "Schema objects, merged")

## Context

`TypeDeriver`'s `typesMap` is `Record<string, string>` with a mini-language in `toSchema` (`core/src/lib/paths.ts:463-469`):

- `'any'` means `{}`.
- A value starting with `#` means `{ $ref }`.
- Anything else means `{ type }`.

The constructor's default parameter means that passing a map replaces `defaultTypesMap` (`core/src/lib/deriver.ts:140`), so every caller spreads the defaults in. 12 of the 15 scripts do, and the root export of `defaultTypesMap` that they import was removed in 0.50.

## Decision

A type mapping is a JSON Schema object (`Decimal: { type: 'string' }`, `UIMessage: { type: 'object' }`). `TypeDeriver` always applies its defaults and adds the given mappings on top. The string forms and the export of `defaultTypesMap` are deleted.

## Consequences

- A mapping says what it writes.
- A `$ref` mapping must name a component that exists: the analysis's, or the base document's.
- Every `typesMap` caller migrates.
