# The analysis documents what the error handler sends for each error a route can throw

Status: accepted (user, 2026-11-21: "Metadata only + error handler"), amended 2026-11-23 (see Amendment)

## Context

A Hono app turns a thrown error into a response in `app.onError`, and an unknown path into one in `app.notFound`:

- websets sends 404 `{ error: { code: 'not_found', message } }` from `notFound`. From `onError` it sends 500 `internal`, 400 `invalid_argument` with field details, and the cause's code for any other `HTTPException`.
- text2sql's `onError` turns a thrown `LlmError`, `HarnessError` or `ProfileError` into `{ error, cause }` with the error's own status.

The analysis drops a thrown error that no response analyzer claims (`generic.ts:940-957`), so the scripts copy these shapes by hand, per operation (text2sql) or onto every response ≥ 400 (websets).

## Decision

`@sdk-it/generic`, with `@sdk-it/hono`'s analyzer, reads the app's `onError` and `notFound` handlers:

- For each error class that a route can throw, as its throws are already collected through `returnTokens`, the analysis finds the `onError` branch that narrows that class (`instanceof`) and documents that branch's response on the route.
- A thrown error that no branch narrows gets the handler's response for the fallthrough.
- A route that returns `c.notFound()` documents `app.notFound`'s response, or Hono's default 404 when the app sets none, as its 404. Hono's `Context.notFound` calls the app's handler (`hono/dist/context.js:404-406`). A route that never returns `c.notFound()` gets no such 404.
- A path that no route declares is not documented. OpenAPI 3.2 has no field for it: responses belong to an operation (§4.16, "the expected responses of an operation"), the OpenAPI Object and the Path Item Object have no responses (§4.1.1, §4.9.1), and components "have no effect on the API unless they are explicitly referenced" (§4.7). A typed client cannot request such a path; only a wrong base URL reaches `app.notFound` that way.

RED tests from websets' and text2sql's handlers come first, including a route that returns `c.notFound()`.

## Consequences

- The scripts' `ApiError`, `LlmErrorResponse` and `RecordNotFoundResponse` responses are deleted in their migrations.
- A route documents only the errors it can throw, as the handler sends them.
- websets' "ApiError on every response ≥ 400" becomes exact: a route lists `not_found` only where it returns `c.notFound()`.

## Amendment (2026-11-23)

Building the decision settled how a branch reads the error, where its status comes from, and what an app with no `onError` sends.

### A branch reads each member from the throw site

Each `error.<member>` that a branch reads is bound to the throw site it is documented for (user, 2026-11-22, decision A). `throw new HTTPException(400, { cause: { code: 'google/invalid-grant' } })` under `c.json({ error: error.message, cause: error.cause }, error.status)` documents `cause.code` as the const `google/invalid-grant`, not as `unknown`. A member that the analysis cannot follow to the throw site is documented by its declared type. A handler-local `const` that reads the error is followed the same way.

Reason: the handler's types alone say `unknown` for every cause, and a client needs the codes each route can send.

The branch is the one that narrows the thrown class: `if (error instanceof X)` or a concise conditional, combined with `!`, `&&` and `||`. A subclass takes its base's branch. A throw that no branch narrows takes the fallthrough. A `throw` inside the handler documents nothing, because Hono then sends nothing and the server adapter answers.

What the analysis reads from a throw:

- Hono's `HTTPException`: its status, and `message`, `cause` and `res` from its options (`HTTPExceptionMembers`, `packages/hono/src/lib/http-exception-members.ts`). Hono ships only the class's declaration, so this reader holds what its constructor does: status 500 and message `''` when the throw gives none.
- An evlog catalog throw: its `code`, and `status`, `message`, `why`, `fix` and `link` from the call's options or else the catalog entry (`EvlogErrorMembers`, `packages/hono/src/lib/evlog.ts`). An entry with no status is evlog's 500.
- A class that the program reads as source: its constructor (`ConstructorMembers`, `packages/generic/src/lib/constructor-members.ts`): parameters, parameter properties, field initializers, `super(...)` chains, ECMAScript's `Error(message, { cause })`, and a source helper that returns one construction (`throw conflict(409)`).

### The status is one number literal, or the analysis fails

Each response's status is one number literal per throw site: a literal, a member the site binds to one, a ternary the site decides, or a table read whose property type is one literal (`packages/hono/src/lib/status-resolver.ts`). A member that the status reads as a key distributes, so `statusOf[error.code]` documents each code the site can produce at its own status. Any other status fails the analysis, naming the throw site, the handler, the status, its type and the fix, such as "Declare `statusOf` as const satisfies `Record<Code, 400 | 404>`".

Reason (user, 2026-11-23: "be strict and force the host to improve their code"): a status the document guesses, such as `default` or every status a `number` allows, documents a response the server does not send. The host states the fact in its types, and the compiler keeps it true.

### Hono's default handler

An app with no `onError` documents what Hono's own handler sends (`hono/dist/hono-base.js`): an `HTTPException` is its message as `text/plain` at its status, and any other error is 500 `text/plain` `Internal Server Error`. `validate()` throws an `HTTPException`, so its 400 and 415 are the body the app's `onError` sends for it, or Hono's `text/plain` with none.

Reason: these are the bytes Hono sends. The throw-alone analyzers (`throw.*`, `httpException`, `evlogErrors`) documented bodies that no handler wrote.

### evlog's own JSON is not documented

A catalog throw is documented as the app's `onError` sends it, or as Hono's default 500. evlog's own JSON body is documented only when the handler sends it (`JSON.stringify(error)`). The `@sdk-it/hono/evlog` subpath, `evlogErrors` and `catalogError` are deleted, and no hand-written error analyzer is needed.

### One onError per program

The analysis reads one `app.onError`. A second, or one that does not resolve to a function with a body, fails the analysis naming it. `onError` and `notFound` are read only where they call Hono's own methods. A handler passed by reference or held in an object is resolved. A throw in a middleware factory's own body runs while the app is built and documents nothing.

### Gaps

- `switch (error.code)` inside a branch is not narrowed per site (#5384).
- A value passed through a helper falls back to its type (#5385).
- `HTTPException({ res })` under Hono's default is documented as its message text (#5386).
- A read off a bound member or a destructured error parameter is not bound (#5397).
- Some constructor shapes are not followed (#5426).
- A sub-app's `onError` waits for mount tracking (ADR 0009).
