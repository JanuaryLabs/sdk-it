# A base document is merged under what the analysis finds

Status: proposed

## Context

Each of the 15 scripts builds the same frame by hand: `openapi`, `info`, `servers`, `security`, `tags.map(name => ({ name, ...meta }))`, `components: { ...components, schemas: { ...components.schemas, ...extra } }`. The CLI writes `info: { title: 'API', version: '0.0.0' }`, which nobody chose.

`hono-openapi` takes `documentation`, a base document merged into the generated one. .NET sets `info` and security schemes in a document transformer.

## Decision

`document` is a required base document without `paths`, and `openapi` and `info` are required in it.

- The analysis adds `paths`.
- It adds its components beside the base's. The same key in both is a `ComponentConflictError`, never a silent overwrite.
- It adds a tag object for each tag an operation names, keeping the fields of a tag object the base declares.

## Consequences

- No invented title or version.
- A hand-written component that the analysis also writes (a script's `JsonValue`, for example) fails loudly, so a migration deletes the stale copy.
- `securitySchemes` is no longer an analysis option: the schemes are part of the base document.
