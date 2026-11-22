# The base document holds only what code cannot know

Status: accepted (user, 2026-11-21: "Metadata only + error handler")

## Context

Each of the 15 scripts builds the document's frame by hand, and most of them add components and responses beside the analysis's. Every hand-written schema or response is a fact the analysis misses:

| Hand-written                                                                              | Repos          | The fact                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ValidationError`, the 400 `oneOf`                                                        | 6 (buggy in 5) | `validate()`'s 400; the analysis already documents it (measured)                                                                                                          |
| `JsonValue`, `JsonObject`, `JsonArray`                                                    | 8              | Prisma's JSON types; the deriver already writes them as components (measured)                                                                                             |
| `UnauthorizedErr`, the 401                                                                | 6              | what an auth middleware sends; not documented yet ([ADR 0005](0005-the-analysis-documents-the-responses-a-middleware-sends-itself.md))                                    |
| `ApiError` on every response ≥ 400 (websets), `LlmErrorResponse` per operation (text2sql) | 3              | what `app.onError` and `app.notFound` send; not documented yet ([ADR 0008](0008-the-analysis-documents-what-the-error-handler-sends-for-each-error-a-route-can-throw.md)) |

A merge rule (an error on conflict, or the analysis wins) would only decide which of two copies of one fact survives. The user rejected both as workarounds.

The CLI writes `info: { title: 'API', version: '0.0.0' }`, which nobody chose.

## Decision

`BaseDocument` holds only what code cannot know:

- `openapi` (`'3.1.0' | '3.2.0'`) and `info`, both required
- `servers`
- `security`
- `externalDocs`
- `tags` (tag objects)
- `components.securitySchemes`

It has no `paths`, `components.schemas` or `components.responses`. The type makes them impossible to write. The analysis gives the paths, the schemas and the responses. Each tag an operation names gets a tag object, with the fields of the base's tag object of that name.

A fact the analysis still misses goes in a transformer, as code ([ADR 0003](0003-operation-and-document-transformers-replace-onoperation.md)).

## Consequences

- No two copies of one fact, so there is no merge rule and no conflict error.
- `securitySchemes` leaves `analyze()`, which only copied it into `components`.
- A migration deletes each hand-written schema; the analysis gaps (ADR 0005, ADR 0008) are fixed before the scripts migrate.
