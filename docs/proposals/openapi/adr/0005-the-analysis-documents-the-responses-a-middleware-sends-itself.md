# The analysis documents the responses a middleware sends itself

Status: proposed (user, 2026-11-21: "Fix the analysis")

## Context

Measured on 0.50.x: a route guarded by a middleware that returns `c.json({ error: 'Unauthorized' }, 401)` is documented with 200, 400 and 415 only. `validate()`'s 400 and 415 are documented, but the middleware's own 401 is not.

Six repos (datahub, iworked, thing, bid, ipay, serverize) add that 401 to every operation by hand in `onOperation`.

## Decision

`@sdk-it/generic` follows each middleware a route passes, and documents each response that middleware sends itself as a response of the route. It reuses one shared component per middleware, status and content type, as it already does for a named middleware's thrown responses. A RED test with the measured route comes first.

## Consequences

- The 401 transformers in the six repos are deleted in their migrations.
- A document that lists 401 for a public route shows a wrong middleware order in the app.
