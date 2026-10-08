# Validator ticket verification

Scope: local backlog #2369, #2370, #2406, #1028, #1585, #1586, and #684.
The user requested fixes after comparing all validator copies, using the
`coding:write-test` workflow. Existing property selectors must stay unchanged;
the user explicitly rejected adding callable selectors.

The original ticket verification below was recorded with commit `4549d9c`.
The later singular `detail` correction is documented at the end of this file;
it supersedes the earlier plural spelling without changing ticket scope.

## Source comparison before changes

All 15 distinct variants were rechecked against the comparison inventory.
Only SDK-IT had changed. None supplies a complete malformed-media-type or native
Hono client typing fix. DeepAgents evals guards non-object field reads but freezes
selectors at setup, so its implementation cannot be copied wholesale. The three
generator tickets concern SDK-IT's analyzer/emitter pipeline, not app-local
validator implementations. See [the comparison](hono-validator.md).

## Claim ledger

| #   | Ticket | Test / caller-visible claim                                                                                                                                                             | Assumes                                                   | Status                                                 |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| C1  | #2369  | Malformed media types have a distinct client error through every public entrypoint; missing/unsupported diagnostics and valid parameterized types are preserved.                        | Nothing                                                   | CAUGHT                                                 |
| C2  | #2370  | Field selection from null/arrays/scalars returns a structured 400, normal objects work, whole-body values stay intact, and selectors remain per-request.                                | Nothing                                                   | CAUGHT                                                 |
| C3  | #2406  | Native Hono client inference correctly describes query-only routes, wire aliases, optional/default/transformed fields, JSON/form targets, repeated queries, and parsed context outputs. | Existing property-selector API                            | unproven; blocked by missing wire-key type information |
| C4  | #1028  | The package declares its supported Zod version; incompatible root/nested schemas get an actionable diagnostic; compatible separate Zod 4 instances work.                                | Isolated consumer packages                                | CAUGHT                                                 |
| C5  | #1585  | OpenAPI stringbool body inputs match the JSON accepted by the route, retaining string inputs and boolean parsed outputs.                                                                | Nothing                                                   | CAUGHT; existing fix                                   |
| C6  | #1586  | Generated input validators keep required type unions required while allowing omission of optional unions.                                                                               | Generated consumer project                                | CAUGHT; existing fix                                   |
| C7  | #684   | Generated TypeScript and Zod output both preserve nullable anyOf values and keep optionality separate in requests and responses.                                                        | Generated consumer project with strict TypeScript enabled | CAUGHT; existing fix                                   |

## Native Hono client constraint

`query: Record<string, Select<'query'>>` gives `payload.query.after` and
`payload.query.limit` identical types. The callback's result preserves a config
key such as `cursor`, but not the source key `after`. Hono's `hc` consumes the
route's input type; it does not inspect the selector's JavaScript expression.
Replacing `never` with config keys would therefore claim a client should send
`cursor` where the server reads `after`.

Exact wire-alias inference needs that missing information represented at the
type boundary. Changing selector syntax or adding mapping metadata is outside
the user's permitted contract. #2406 stays open; no cast, relaxed dictionary, or
config-key substitution is presented as a complete fix. The existing correct
`c.var.input` output inference remains intact.

## Review dispositions

The discovery, requirement comparison, mutation proof, and gotcha review were
delegated independently to `test_discovery`, `claim_comparison`,
`mutation_proof`, and `test_review`. The comparator's final pass accepts C1, C2,
C4, C5, C6, and C7 and confirms C3 is still unresolved. The reviewer rechecked
the two test corrections and reports no remaining findings.

| Finding                                                                              | Disposition                                                                                                                      |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Comparator C1: missing malformed/unsupported distinction                             | fixed: ledger and request assertions cover distinct diagnostics                                                                  |
| Comparator C2: missing explicit body classes and structured errors                   | fixed: claim names null, arrays, scalars, objects, and structured client errors                                                  |
| Comparator C3: missing defaults/transforms/content types/context output              | fixed in ledger; implementation remains unproven under the API constraint                                                        |
| Comparator C4: unspecified consumer contract                                         | fixed: claim includes declaration, migration diagnostics, and isolated consumers                                                 |
| Comparator C5: missing JSON-body runtime/generation contract                         | fixed: retain and verify the existing public integration regression                                                              |
| Comparator C6: missing optional union behavior                                       | fixed: retain and verify required and optional cases                                                                             |
| Comparator C4: separate compatible Zod 4 instances exceed the minimum ticket wording | answered: this is part of the chosen supported consumer contract; legitimate imported schemas must work across package instances |
| Reviewer C1: public `openapi` alias omitted from malformed-header cases              | fixed: both alias overloads now share the request cases; targeted Nx run passes                                                  |
| Reviewer C7: requiredness only checked on generated response types                   | fixed: strict consumer also rejects missing and undefined request prices; targeted Nx run passes                                 |
| C7 initial fixture: minimal generation has no consumer tsconfig                      | fixed: use the supported full generated project; this was an invalid fixture setup, not a product failure                        |
| C7 initial fixture: guessed generated model export was not a module                  | fixed: obtain the response through the generated public client; this was an invalid fixture setup, not a product failure         |
| Nx lint could not see Zod use in emitted evaluation source                           | fixed: declare Zod through Nx's `runtimeHelpers`; the peer dependency remains checked, and core lint now passes                  |

## Evidence

The live pre-fix request probe is `/tmp/sdk-it-validator-boundaries-before.json`.
C1 failed through the Nx test target with `500 !== 415`, then passed after using
the installed content-type parser's `safeParse` API and translating its invalid
result into a structured 415. Logs: `/tmp/sdk-it-C1-red.log` and
`/tmp/sdk-it-C1-green.log`.

C2 failed with `500 !== 400` and C4 failed with an obscure Zod 3 `TypeError`
instead of the required migration message. Their fixes passed their focused Nx
targets: `/tmp/sdk-it-C2-{red,green}.log` and
`/tmp/sdk-it-C4-{red,green}.log`.

C5 and C6 already had the requested fixes and regression tests. Their focused
Nx runs passed (`/tmp/sdk-it-C5-green.log`, `/tmp/sdk-it-C6-green.log`). C7 gained
a full generated-project regression, also passing (`/tmp/sdk-it-C7-green.log`).
After review, the expanded C1 and C7 tests passed again:
`/tmp/sdk-it-C1-review-green.log` and `/tmp/sdk-it-C7-review-green.log`.

All four package suites ran through Nx: **430 passed, 69 existing TODOs, zero
failures** (`/tmp/sdk-it-validator-ticket-suites.log`). Counts by package:

| Package    | Passed | Existing TODOs |
| ---------- | -----: | -------------: |
| core       |    173 |             62 |
| hono       |     55 |              7 |
| generic    |     66 |              0 |
| typescript |    136 |              0 |

Core, Hono, and TypeScript typechecks passed through Nx
(`/tmp/sdk-it-validator-ticket-types.log`). Their lint targets pass with existing
warnings; core's initial dynamic-dependency false positive was resolved and
rerun (`/tmp/sdk-it-C4-lint-green.log`).

## Mutation proof

The prover used the skill's `scratch-copy.mjs` and `mutate.mjs`, disabled Nx
caching, rebuilt each source mutation, checked the emitted bundle marker, and
ran the named regression through `nx run <package>:test`. Every focused baseline
ran one test and passed. The additional Hono suite baseline had 55 passes and 7
existing TODOs. Mutations never touched the working checkout.

| Claim              | Source regression                                                             | Observed failure                                                                 | Verdict |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| C1                 | Accept a malformed content-type parse result                                  | HTTP 200 instead of 415                                                          | CAUGHT  |
| C1 review          | Replace the `openapi` alias with a middleware that bypasses validation        | HTTP 400 instead of 415                                                          | CAUGHT  |
| C1 review, precise | Make only `openapi` a pass-through middleware, preserving valid 200 responses | Malformed requests return 200 instead of 415                                     | CAUGHT  |
| C2                 | Remove the non-object field-read guard                                        | HTTP 500 instead of 400                                                          | CAUGHT  |
| C4                 | Remove the actionable Zod 4 migration diagnostic                              | Diagnostic assertion rejects the generic error                                   | CAUGHT  |
| C5                 | Analyze Zod output instead of wire input                                      | OpenAPI boolean instead of string                                                | CAUGHT  |
| C6                 | Make a required type-array union optional                                     | Generated required-union validation fails                                        | CAUGHT  |
| C7                 | Drop runtime nullability                                                      | Generated schema rejects `{ price: null }`                                       | CAUGHT  |
| C7                 | Drop TypeScript nullability                                                   | Strict generated consumer rejects null assignments                               | CAUGHT  |
| C7 review          | Wrap only the client's request input type in `Partial`                        | Missing/undefined request prices become accepted; expected-error directives fail | CAUGHT  |

All ten final mutation checks were CAUGHT. Raw evidence, commands, and emitted markers are recorded in
`/tmp/sdk-it-mutation-proof-report.json`. The scratch copy was removed with the
skill's cleanup command; no owned processes remain.

## Mutation attempt dispositions

The following attempts are recorded separately so setup errors and wrongly
targeted mutations are not counted as proof.

| Run / mutation                                                                   | Result and cause                                                                                                                             | Disposition                                                                                                                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| setup before first mutation run / `(none; spec validation)`                      | INVALID: Top-level command argv missing; mutate.mjs exited before baselines or edits.                                                        | fixed: Added required top-level command; subsequent runs executed.                                                                                      |
| first mutation run attempt / `(none; built marker path)`                         | INVALID: ENOENT while checking guessed built marker path after baselines and before applying a mutation.                                     | fixed: Used actual bundle packages/hono/dist/lib/runtime/index.js.                                                                                      |
| first completed batch after built-path correction / `C6`                         | INVALID: Built marker did not match emitted package bundle.                                                                                  | fixed: Retargeted to type-array subSchemas union and confirmed CAUGHT.                                                                                  |
| first completed batch after built-path correction / `C7-zod-null-initial`        | INVALID: Built marker quote spelling did not match emitted package bundle.                                                                   | fixed: Replaced with the precise type-array nullable=false mutation and confirmed CAUGHT on price:null.                                                 |
| first completed batch after built-path correction / `C7-typescript-null-initial` | INVALID: Built marker quote spelling did not match emitted package bundle.                                                                   | fixed: Retargeted to normalized type-array null removal and confirmed CAUGHT by strict consumer compile.                                                |
| first refreshed full batch / `C1-openapi-initial`                                | INVALID: Build rejected direct overloaded-function cast with TS2352.                                                                         | fixed: Cast through unknown; the alias-specific test then caught the mutant.                                                                            |
| first refreshed full batch / `C6-anyOf-initial`                                  | SURVIVED: Mutation changed anyOf handling, while the C6 test exercises OpenAPI type arrays.                                                  | fixed: Changed mutation to the type-array subSchemas union; final result CAUGHT.                                                                        |
| first refreshed full batch / `C7-zod-null-initial`                               | INVALID: Mutation-in-build marker mismatch.                                                                                                  | fixed: Replaced with the precise nullable=false type-array mutation; final result CAUGHT.                                                               |
| first refreshed full batch / `C7-typescript-null-initial`                        | INVALID: Mutation-in-build marker mismatch.                                                                                                  | fixed: Replaced with normalized type-array null removal; final result CAUGHT.                                                                           |
| first refreshed full batch / `C7-request-required-initial`                       | SURVIVED: Mutation changed the anyOf emitter, which was not the path used for normalized nullable properties.                                | fixed: Changed to a type-only client request input mapping mutation; final strict compile CAUGHT it.                                                    |
| corrected C6/C7 source batch / `C7-request-runtime-optional`                     | INVALID: The test failed at runtime for {}, but the built marker did not match; this changed validation behavior rather than request typing. | fixed: Replaced with a type-only Partial<z.input<...>> mutation in client.ts; strict consumer compile CAUGHT it while runtime schemas stayed unchanged. |
| first cleanup attempt / `(none; cleanup)`                                        | INVALID: scratch-copy --remove hit spawnSync ps EPERM before deletion.                                                                       | fixed: Retried the supported removal command with escalation; cleanup succeeded and killedPids was empty.                                               |

| Reviewer-named mutation                                                                | Disposition                                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `openapi` bypasses malformed-header validation while accepting valid requests          | fixed: pass-through middleware mutation CAUGHT with 200 instead of 415; valid requests remain accepted     |
| Request type permits omitted price while response type and runtime schema stay correct | fixed: type-only `Partial` input mutation CAUGHT by strict compilation on unused expected-error directives |

## Ticket disposition

- #2369, #2370, and #1028 are fixed and marked done.
- #1585, #1586, and #684 were already fixed; their done tickets now include the
  fresh verification evidence.
- #2406 remains open and unproven under the selector API constraint. The full
  request to fix every ticket is therefore **not complete**.

## Workflow checklist

- [x] test-discoverer map in hand — `test_discovery` identified public entrypoints and existing coverage.
- [x] Claim ledger written from the requirement, failure modes first — C1–C7 above.
- [x] test-claim-comparator: nothing unclaimed or weakened — `claim_comparison` accepted six claims and explicitly identified unresolved C3.
- [x] One RED → GREEN at a time, in ledger order — C1, C2, C4 logs above; C5–C7 already fixed and proved by mutations.
- [x] test-mutation-prover: every implemented test CAUGHT — `mutation_proof`; C3 has no claimed proof.
- [x] test-gotcha-reviewer: every finding fixed or answered — `test_review` rechecked both corrections with no remaining findings.
- [x] Done when — verification workflow complete; the product limitation in #2406 is explicitly unproven.

## Singular `detail` correction

The user corrected the error contract to singular `detail`, following .NET
Problem Details. The relevant standard is RFC 7807, superseded by
[RFC 9457 section 3.1.4](https://www.rfc-editor.org/rfc/rfc9457.html#section-3.1.4).
All seven validator error-cause branches now use `detail`; no plural alias is
retained. Status codes, error codes, messages, and validation issues stay intact.
The application still owns serialization of a complete Problem Details response.

Existing public integration tests cover the correction; no duplicate tests or
test-only production interfaces were added.

| Claim | Existing test                                                                              | What it proves                                                                         | Assumes | Status |
| ----- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------- | ------ |
| D1    | missing required field returns 400 with field error entry                                  | Validation failure exposes singular detail and no plural alias                         | Nothing | CAUGHT |
| D2    | malformed media types have a distinct client error through every public entrypoint         | Malformed, missing, and unsupported media-type diagnostics use singular detail         | Nothing | CAUGHT |
| D3    | GET with content-type header is rejected with 415                                          | GET media-type rejection uses singular detail and no plural alias                      | Nothing | CAUGHT |
| D4    | unsupported content-type returns 415 when expected type set                                | Unsupported media-type rejection uses singular detail and no plural alias              | Nothing | CAUGHT |
| D5    | missing content-type with expected type returns 415                                        | Missing media-type rejection uses singular detail and no plural alias                  | Nothing | CAUGHT |
| D6    | non-object field selections fail without changing whole-body values or per-request schemas | Non-object field rejection uses singular detail and retains the body/selector contract | Nothing | CAUGHT |
| D7    | malformed JSON returns a structured 400 without running the handler                        | JSON syntax rejection uses singular detail                                             | Nothing | CAUGHT |
| D8    | parse preserves both root and nested issues from one schema                                | Direct parse rejection uses singular detail and preserves root/nested issues           | Nothing | CAUGHT |

Evidence:

- `/tmp/sdk-it-detail-before.json` reproduced plural keys through real Hono
  requests. `/tmp/sdk-it-detail-after.json` contains the same responses with only
  `details` renamed to `detail`; the structural comparison passed.
- D1, D2, D3, D6, and D7 each failed on the old key before its production branch
  was changed, then passed through the Nx test target. Logs are
  `/tmp/sdk-it-detail-D*-{red,green}.log`. D4/D5 share the verifier corrected by D2;
  D8 shares the parser corrected by D1. Their updated integration assertions also
  passed before mutation verification.
- `nx run-many -t test typecheck lint -p @sdk-it/hono --parallel=1` passed:
  55 tests, 7 existing TODOs, no failures; lint has 4 existing warnings and no
  errors. Log: `/tmp/sdk-it-detail-checks.log`.
- `test_discovery` refreshed the eight-test map; `claim_comparison` accepted
  D1–D8 with no missing or weakened requirements.

| Finding                                      | Disposition                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| User's RFC number is 7084                    | answered: Problem Details is RFC 7807, superseded by RFC 9457; the requested singular field is correct |
| Discovery abbreviated the Nx project as hono | fixed: used the configured project name `@sdk-it/hono` for every run                                   |

The independent reviewer found no remaining issues. The mutation prover ran all
eight corrected tests: the baseline passed 8/8; changing the seven production
`detail` keys back to `details` failed all 8/8. There were no INVALID or SURVIVED
attempts in this correction pass.
The detailed proof is `/tmp/sdk-it-detail-proof-report.json`; emitted code was
verified in `packages/hono/dist/lib/runtime/index.js`. The scratch copy was
removed successfully with no owned processes left running.

Correction workflow checklist:

- [x] test-discoverer map in hand — `test_discovery`, eight existing integration tests.
- [x] Claim ledger written from the requirement — D1–D8 above.
- [x] test-claim-comparator: nothing unclaimed or weakened — `claim_comparison`, no gaps.
- [x] One RED → GREEN at a time — branch-specific Nx logs above; shared branches verified by their other callers too.
- [x] test-mutation-prover: every test CAUGHT — one source regression, eight named tests fail.
- [x] test-gotcha-reviewer: every finding fixed or answered — `test_review`, no findings.
- [x] Done when — correction verified through public HTTP/parse entrypoints and Nx targets; full RFC response serialization remains application-owned.

## 0.46.7 release and consumer verification

The release build and all eleven generated-client fixtures passed after the
consumer migration exposed a control-flow narrowing regression. Following a
`const` initializer discarded the narrowed type at a guarded response use site.
The deriver now preserves that use-site type before following the declaration.

| Claim | Caller-visible result                                                                                                                          | Failure prevented                                   | Test boundary                                                                                                 | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| N1    | Strict generated comparison clients can read `baseline.id` and `candidate.id` directly as strings; the optional sibling still requires a guard | Guarded response fields incorrectly become optional | Real Hono requests, public analyzer and generator, strict generated client compiled with TypeScript; no mocks | CAUGHT |

`packages/generic/src/lib/narrowed-responses.test.ts` failed before the fix with
both guarded fields reported as possibly undefined, then passed. Core and generic
Nx typechecks passed. The four package suites passed **431 tests**, with 69
existing TODOs and no failures. Full release builds and the eleven end-to-end
SDK fixtures passed with Node, Bun, TypeScript, and DOM-library checks.

Evidence logs:

- `/tmp/sdk-it-narrowing-red-interface.log`
- `/tmp/sdk-it-narrowing-green.log`
- `/tmp/sdk-it-narrowing-verification.log`
- `/tmp/sdk-it-release-recheck.log`
- `/tmp/sdk-it-narrowing-proof-report.json`

The independent mutation prover reversed the use-site narrowing condition in a
scratch copy, confirmed the emitted marker, and observed both expected strict
consumer errors. The baseline passed 1/1 and the mutant failed 1/1. Scratch cleanup
succeeded with no remaining owned processes.

| Finding / attempt                                                                                     | Disposition                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Analyzer-only assertions do not prove generated client usability                                      | fixed: the test generates a full public client and compiles a strict consumer                                                             |
| Initial inline type-alias fixture also exposed a separate optional-object emitter bug                 | answered: the final fixture uses the real consumer's interface pattern; the independent emitter defect is captured as #2443               |
| Comparator questioned negative wording in the failure column                                          | answered: the caller-visible claim is positive; the adjacent column describes the regression being prevented                              |
| First mutation attempt failed with `kill EPERM` during process-group cleanup before producing results | INVALID; fixed: confirmed no owned test process remained and reran the supported mutator with authorized escalation; final verdict CAUGHT |
| Independent test review                                                                               | no findings or additional mutations requested                                                                                             |

Narrowing workflow checklist:

- [x] Discovery map — `narrowing_discovery`.
- [x] Claim ledger and comparison — N1, `claim_comparison`.
- [x] Exact RED → GREEN through the Nx test target.
- [x] Independent mutation proof — `mutation_proof`, CAUGHT.
- [x] Independent test review — `test_review`, no remaining findings.
- [x] Real consumer confirmation — DeepAgents regenerated frontend typecheck passes.

Consumer preparation used packed 0.46.7 artifacts. DeepAgents' HTTP, schedule,
and upload suites passed **49 tests**; experimental, eval backend, and eval
frontend Nx typechecks passed. Limerence's desktop logs, providers, and data-source
route suites passed **3 integration tests**. Both Limerence clients regenerated.
Its initial complete typecheck was blocked until the registry install: dependency
lint read the old lockfile version and rejected the new manifest range.

The spec comparison retained 25 DeepAgents, 175 Limerence main, and 70 Limerence
v2 operations. DeepAgents' two defaulted request schemas correctly became less
restrictive; Limerence's guarded current-user response became non-nullable.
Moving middleware into a published declaration-only dependency also removes its
documented 400/415 responses. Runtime errors remain covered, but generated error
metadata is incomplete; this package-analysis gap is captured as **#2444**.

## Release completion, 2026-10-08

The refreshed credential resolved the publishing rejection. `nx release publish`
published all twelve public packages at **0.46.7**. Every package's registry
record and `latest` tag were verified after npm's availability delay. SDK-IT
`main` and `release/0.46.7` were pushed; the release tag points to `3dfdddf`.
The repository's pre-push test/build checks also passed.

DeepAgents and Limerence now install the release from npm. Their lockfile changes
are limited to the SDK-IT packages and the affected workspace manifests; no
temporary tarball paths remain. The installed package files match the packed
artifacts used for the 49 DeepAgents and 3 Limerence route tests byte for byte.
Five local validator copies and DeepAgents' orphan parser were removed.
Limerence's three now-unused direct content-type parser dependencies were removed;
DeepAgents retains its parser dependency for the upload route.

Final verification against the registry packages:

- DeepAgents: experimental runtime, eval backend, and regenerated frontend Nx
  typechecks all passed, including their dependency tasks.
- Limerence: backend, desktop-backend, v2-backend, client, v2-client,
  desktop-frontend, and v2-frontend Nx typechecks passed with lint/format tasks.
- Limerence's main frontend full check is blocked by a pre-existing dependency
  attribution error: `frontend -> data-sources -> google-connectors` causes lint
  to demand `google-auth-library`. This is captured as **#2446** in Limerence's
  backlog. Its compiler target passed separately through
  `nx run frontend:typecheck --excludeTaskDependencies`; that does not count as
  a passing full lint/typecheck pipeline.

Final logs: `/tmp/sdk-it-publish-final.log`,
`/tmp/deepagents-sdk-registry-ready.log`,
`/tmp/limerence-sdk-registry-ready.log`,
`/tmp/deepagents-sdk-published-typechecks.log`,
`/tmp/limerence-sdk-published-typechecks.log`, and
`/tmp/limerence-sdk-frontend-compiler.log`.

Known limitations remain explicit: #2406 is unresolved under the unchanged
property-selector API constraint; #2443 tracks optional inline object emission;
#2444 tracks missing published-middleware error response metadata.
