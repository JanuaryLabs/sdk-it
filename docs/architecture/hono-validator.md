# Canonical Hono request validator

The maintained implementation is
[`packages/hono/src/lib/runtime/validator.ts`](../../packages/hono/src/lib/runtime/validator.ts),
exported from `@sdk-it/hono/runtime`. New applications should import `validate`,
`parse`, and `consume` from that package. Shared fixes belong here with request-level
regression tests, rather than in another application copy.

This document records the comparison made on 2026-10-07 and the resulting contract.
It does not imply that existing consumers have migrated or that a new package
version has been published.

## Comparison baseline

The local search found 32 related files: 20 files in primary checkouts and 12
worktree copies. Exact-content deduplication left 15 variants across 13
repositories. The comparison below describes those files **before** this
consolidation, so later SDK-IT changes do not erase the baseline.

Every variant has the same basic `select` / `against` API. Their substantive
differences concern request parsing, errors, type inference, and when the selector
executes. Recency alone does not establish which behavior should be canonical.

| Variant                | Source within repository                                      | Difference from the SDK-IT baseline                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK-IT                 | `packages/hono/src/lib/runtime/validator.ts`                  | Zod 4 errors; async object parsing; raw query strings; per-request selectors; no JSON syntax-error translation; last repeated form value wins.                                                                                                   |
| DeepAgents evals       | `apps/evals-web-runner/backend/src/middlewares/validator.ts`  | Builds the schema once using proxy-backed selectors; correctly models optional output keys; guards property selection from non-object bodies; structured invalid-JSON errors; converts query `"null"` to null; singular `detail`.                |
| DeepAgents HTTP plugin | `packages/experimental/src/zukhruf/plugins/http/validator.ts` | Per-request selectors with actual request-value types and `body: unknown`; supports whole-body selection; models optional output keys; removes Hono input-target metadata; delegates to local `parse.ts`; JSON errors and query-null conversion. |
| Serverize              | `apps/api/src/app/core/validator.ts`                          | Synchronous parsing; compares raw content-type headers; no multipart branch or content-type overload; typo `fatel` in issue metadata; cookie marker incorrectly mapped to `form`.                                                                |
| Text2SQL backend       | `apps/backend/src/middlewares/validator.ts`                   | Delegates parsing to `@backend/inputs`; JSON errors; query-null conversion; singular `detail`; assertions and lint annotations differ.                                                                                                           |
| Text2SQL desktop       | `apps/desktop/backend/src/middlewares/validator.ts`           | Same observable logic as backend; extracts the JSON error message into a local variable. Different bytes do not imply different behavior.                                                                                                        |
| Bid                    | `apps/backend/src/middlewares/validator.ts`                   | JSON errors; singular `detail`; Zod 3-style `flatten` and `fatal`; query values remain strings. Also represents IPay and Impact Hub.                                                                                                             |
| Blackboard             | `apps/api/src/core/middlewares/validators/validator.ts`       | JSON errors; query-null conversion; singular `detail`; delegates to local `parse.ts`; narrows caught errors instead of casting to `any`.                                                                                                         |
| Thing                  | `apps/backend/src/middlewares/validator.ts`                   | JSON errors; query-null conversion; singular `detail`; Zod 3-style `flatten` and `fatal`. Also represents IWorked and PM.                                                                                                                        |
| Cold Ambulance         | `apps/backend/src/middlewares/validator.ts`                   | Zod 4 error handling; `parse` accepts any Zod schema, including task payload schemas; JSON errors; query-null conversion; singular `detail`.                                                                                                     |
| Datahub                | `apps/backend/src/middlewares/validator.ts`                   | Inline JSON error translation with a stable message; raw query values and plural `details` remain; Zod 3-style issue handling.                                                                                                                   |
| Education              | `apps/backend/src/middlewares/validator.ts`                   | JSON errors; query-null conversion; singular `detail`; Zod 4-style `z.flattenError`.                                                                                                                                                             |
| GI backend             | `apps/api/src/middlewares/validator.ts`                       | `parseBody({ all: true })` preserves repeated form fields/files; erased tagged selector types replace marker classes; JSON errors; query-null conversion; removes `openapi` alias; adds API comments.                                            |
| Virtual Care           | `apps/backend/src/middlewares/validator.ts`                   | Same runtime choices as Thing; casts flattened errors and JSON-error detail to explicit types; redundant `void` on content-type verification. Also represents both Conductor copies.                                                             |
| January                | `libs/extensions/src/hono/validator.txt`                      | Template with the same old behavior as Serverize plus an ESLint directive.                                                                                                                                                                       |

The two DeepAgents files had the newest commits (2026-10-07), but their selector
models conflict. The evals implementation executes callbacks during route setup;
the HTTP plugin executes them per request. Neither should be copied wholesale.

## Adopted behavior

1. **Malformed JSON returns 400.** Adopt Datahub's stable `api/invalid-json`
   response. Do not expose engine-specific parse messages or snippets of request
   content. The selector and route handler do not execute when parsing fails.
2. **Repeated form fields are preserved.** Adopt GI backend's native Hono
   `parseBody({ all: true })`. Its upload route consumes multiple files under
   `files`; this is a demonstrated use case. A single unsuffixed form field
   remains a scalar; repeated occurrences become an array. Hono's `field[]`
   convention always produces an array, retaining the `[]` in the key.
3. **`parse` accepts any Zod schema.** Adopt Cold Ambulance's broader API and
   explicitly return `Promise<z.output<T>>`. Object, union, array, scalar, and
   transformed schemas can share the same HTTP error handling.
4. **Root errors remain visible.** Preserve existing `cause.errors` for field
   errors and add `cause.formErrors` for issues whose path is empty. Broadening
   `parse` must not turn a rejected scalar/union into an empty error report.
5. **Parsed output reflects the actual Zod object.** Derive `c.var.input` from
   `z.output<z.ZodObject<...>>`, adopting DeepAgents' optional-key inference
   without its proxies or runtime shape assertions. Defaults and transformations
   describe parsed outputs, not wire inputs.
6. **Use `detail` consistently.** The canonical error cause uses singular
   `detail` for every validator error, following the Problem Details field name
   from [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html#section-3.1.4),
   which supersedes RFC 7807, and .NET's `ProblemDetails.Detail`. This corrects
   the initial consolidation's plural spelling. Applications own the response
   serialization; the exception cause itself is not a complete Problem Details
   HTTP response.
7. **Erase selector markers.** Adopt GI backend's tagged types instead of
   allocating unused marker classes. The selector still receives actual request
   values, not runtime marker objects. Retain the source distinctions in its
   declaration without copying GI's removal of the `openapi` alias.
8. **Use native request headers and entry construction.** Adopt the DeepAgents
   HTTP plugin's direct `c.req.header()` and `Object.fromEntries` construction
   for schema/input records. Hono already returns normalized header names;
   missing headers stay absent. Rebuilding schemas remains per request.
9. **Malformed media types return 415.** Use the installed parser's `safeParse`
   result to distinguish invalid syntax from missing and valid-but-unsupported
   content types. `validate`, its `openapi` alias, `consume`, and
   `verifyContentType` share this check.
10. **Guard field reads from non-object JSON.** Null, arrays, and scalars remain
    valid candidates for whole-body schemas. Only a property read on such a body
    throws a structured 400 (`api/invalid-body`). A per-request property guard is
    unwrapped back to the original body before Zod; it does not compile selectors
    at setup or catch exceptions from application code.

## Deeper comparison and evidence

The second pass rehashed all 32 inventory entries: only SDK-IT had changed. It
reviewed every distinct diff, including the actual parsers imported by Text2SQL,
Blackboard, and the DeepAgents HTTP plugin. Text2SQL's installed
`@backend/inputs` resolves to `packages/backend/inputs/dist/index.js`; its source
and built parser both discard root errors. Moving `parse` into a separate file
does not add a different validation contract.

Request probes ran against eight implementations using their locally installed
Hono/Zod dependencies: SDK-IT, both DeepAgents variants, both Text2SQL variants,
Blackboard, Cold Ambulance, and Datahub. The other seven variants were reviewed
from source because their checkout lacks required dependencies (the January
variant is also a text template). No dependencies were installed in those repos.

| Candidate                          | Evidence and decision                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile selectors once             | DeepAgents evals ran the selector during route setup, retained an old closure-derived default on the second request, and rejected an otherwise valid whole-body array. Keep SDK-IT's per-request execution.                                                                                                                                                             |
| Guard reads from non-object bodies | DeepAgents evals turns a field read from JSON `null` into a field validation error, but achieves it through the setup-time marker model. Preserve the useful requirement as #2370; copying that implementation breaks existing whole-body and dynamic selectors.                                                                                                        |
| Validate the whole body            | DeepAgents HTTP's `/session/:sessionId` route validates `payload.body` with a strict schema. SDK-IT already supports that at runtime; new integration coverage preserves object, array, scalar, and null inputs and strict-object rejection. This does not imply static OpenAPI support.                                                                                |
| Preserve upload fields             | GI backend's `/ai/upload` consumes `payload.body.files` and explicitly normalizes one file or several in its application schema. Preserve all values in the shared parser; keep endpoint limits and scalar-to-array normalization application-owned.                                                                                                                    |
| Parse arbitrary schemas            | Cold Ambulance's task dispatcher calls `parse(task.payload, ...)`. Keep the broader API and root errors; do not reintroduce object-only typing from extracted parser copies.                                                                                                                                                                                            |
| Error payload typing               | Some copies annotate flattened errors as a record for their response analyzer. Do not cast away field/issue structure or restore Zod 3 `fatal` metadata. Request tests now verify simultaneous root and nested errors.                                                                                                                                                  |
| Native Hono client input metadata  | The inherited `InferIn` intersects `never` for absent targets, including an unselectable cookie target. It also describes parsed outputs and config aliases rather than wire inputs/names. DeepAgents HTTP removes the metadata; GI's tags do not fix it. Record the full repair as #2406 instead of partially patching it or claiming Hono client typing is supported. |
| Earlier content-type behavior      | Serverize/January compare raw header strings, omit multipart parsing, and lack the GET restriction. Retain the current contract and verify mixed-case media types with charset parameters through both `consume` and `validate`.                                                                                                                                        |

The remaining differences are formatting, lint annotations, casts, local
variables, API comments, or the deliberately rejected query-null/error-spelling
policies. API comments were adopted without carrying application-specific lint
suppressions into the package.

## Retained behavior and deliberate exclusions

- Query values remain literal strings, including `"null"`. Converting that value
  globally would change valid string inputs. Applications needing a null sentinel
  can opt in explicitly with a schema such as
  `z.preprocess(value => value === 'null' ? null : value, z.string().nullable())`.
  This is the agreed canonical policy.
- Selectors still run per request. No setup-time proxy compilation or schema
  caching is introduced. Schema construction may depend on request values or
  closures in existing applications. The field-read guard applies only to
  non-object bodies; ordinary object, query, path, and header values stay intact.
- Keep Zod 4's `z.flattenError` and the issue fields `message`, `code`, and `path`.
  Do not restore Zod 3's `fatal` or the old `fatel` typo.
- Keep `openapi` as the existing runtime alias of `validate`. For static OpenAPI
  analysis, use the documented `validate` spelling and direct field selectors.
- Keep existing content-type enforcement, including case/parameter parsing, GET
  rejection when a content-type header exists, and singular `cause.detail` on 415
  errors. All validator error causes now use that same spelling.
- `text/plain` can be enforced, but the selector's body is not populated from
  text. Cookie marker types do not constitute cookie extraction. Neither is
  advertised as a new request-body or cookie capability.
- The static analyzer currently reads direct selector expressions. Whole-body
  selection from the DeepAgents HTTP plugin is not promoted as a supported
  OpenAPI-generation pattern by this change.

The follow-up ticket pass is documented in
[the verification ledger](hono-validator-ticket-verification.md):

- **#2369:** malformed media-type syntax now returns a structured 415 instead of
  HTTP 500.
- **#2370:** selecting `payload.body.name` from a null or non-object JSON body now
  returns a structured 400, while whole-body validation retains the raw value.
- **#2406:** Hono client input metadata collapses to `never` and does not correctly
  describe wire names/types. This remains open: exact renamed wire keys are lost
  by the current index-signature type, and the user forbids changing the property
  selector API. Parsed `c.var.input` inference remains covered.

## Adoption and compatibility

Publish a verified SDK-IT release before migrating consumers. Replace local
validator imports with `@sdk-it/hono/runtime`; keep application-specific schemas
in their applications. Do not retain a second copy of shared middleware behavior.

Before migrating each application, check these concrete differences:

- Repeated form fields now produce arrays instead of silently selecting the last
  occurrence. Scalar schemas will reject repeated input. For upload endpoints
  accepting either one file or several, normalize the scalar in the schema or use
  Hono's `files[]` convention with a corresponding selector.
- Apps that previously translated query `"null"` need an explicit preprocessing
  schema if their clients rely on that encoding.
- Consumers serializing `HTTPException.cause` now also expose `formErrors`.
  Root-error paths are the empty string; nested field paths remain dot-joined.
- Error serializers should read singular `cause.detail`, matching Problem
  Details and the existing Text2SQL/DeepAgents convention. Consumers reading
  plural `cause.details` must switch to `cause.detail`.
- The `parse` API is asynchronous. Older Serverize/January call sites must await
  it. Zod 3 issue fields and types must not be copied into the Zod 4 contract.

## Verification

Regression coverage lives in
[`validator.test.ts`](../../packages/hono/src/lib/runtime/validator.test.ts).
The consolidation first reproduced malformed-JSON 500 responses, discarded form
values/files, and lost root errors against the original implementation. Existing
field-error and content-type tests protect retained behavior.

Run verification through Nx:

```sh
nx run @sdk-it/hono:test
nx run @sdk-it/hono:typecheck
nx run @sdk-it/generic:test
```

The deeper pass adds coverage for dynamic defaults, whole-body JSON, async
refinement rejection, repeated scalar-field rejection, single `field[]` values,
normalized headers/content types, the runtime `openapi` alias, and simultaneous
root/nested errors. The ticket pass adds malformed media-type and non-object
field-selection coverage. Hono now has 55 passes, 7 existing TODOs, and no
failures; the generic analyzer has 66 passes. Across core, Hono, generic, and
TypeScript, 430 tests pass with 69 existing TODOs. The affected typecheck and lint
targets pass. See the [ticket verification ledger](hono-validator-ticket-verification.md)
for consumer-version, generator, review, and mutation evidence.
