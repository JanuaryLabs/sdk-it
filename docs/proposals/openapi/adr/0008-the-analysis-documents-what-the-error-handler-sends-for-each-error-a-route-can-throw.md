# The analysis documents what the error handler sends for each error a route can throw

Status: accepted (user, 2026-11-21: "Metadata only + error handler")

## Context

A Hono app turns a thrown error into a response in `app.onError`, and an unknown path into one in `app.notFound`:

- websets sends 404 `{ error: { code: 'not_found', message } }` from `notFound`. From `onError` it sends 500 `internal`, 400 `invalid_argument` with field details, and the cause's code for any other `HTTPException`.
- text2sql's `onError` turns a thrown `LlmError`, `HarnessError` or `ProfileError` into `{ error, cause }` with the error's own status.

The analysis drops a thrown error that no response analyzer claims (`generic.ts:940-957`), so the scripts copy these shapes by hand, per operation (text2sql) or onto every response ≥ 400 (websets).

## Decision

`@sdk-it/generic`, with `@sdk-it/hono`'s analyzer, reads the app's `onError` and `notFound` handlers:

- For each error class that a route can throw, as its throws are already collected through `returnTokens`, the analysis finds the `onError` branch that narrows that class (`instanceof`) and documents that branch's response on the route.
- A thrown error that no branch narrows gets the handler's response for the fallthrough.
- `notFound`'s response is documented once, as the document's response for a path that does not exist. OpenAPI has no field for that, so the plan settles where it goes before any code.

RED tests from websets' and text2sql's handlers come first.

## Consequences

- The scripts' `ApiError`, `LlmErrorResponse` and `RecordNotFoundResponse` responses are deleted in their migrations.
- A route documents only the errors it can throw, as the handler sends them.
- `notFound` needs a decision on where it goes in the document.
