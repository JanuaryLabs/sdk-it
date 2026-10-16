# Zukhruf adoption in SDK-IT

Audited and implemented on 2026-10-16. The accepted changes use the installed `@zukhruf/testing` 0.3.20 to remove test-owned registration and resource-management code. Production behavior and runtime dependencies remain unchanged.

## Evidence and package boundaries

Three GPT-6.1 Sol agents at xhigh inspected testing, filesystem/async, and coordination independently. The lead inspected ESLint/UI, checked the installed runtime and public npm metadata, implemented the accepted removals, and independently ran their verification.

Upstream is JanuaryLabs/zukhruf, locally checked out at `/Users/ezzabuzaid/Desktop/experiments/mutex`. The final source snapshot was `8aa4c65`. Public npm reported 0.3.20 for the nine non-UI packages; `@zukhruf/shadcn` returned 404. Single-flight fixes after `release/0.3.20` are present locally and must not be attributed to that release.

Zukhruf is a collection of independently usable packages. Its architecture separates base primitives, coordination, domain packages, tools, and UI. It does not require adopting the whole library. The source export condition `@zukhruf/source` is for a linked source checkout; ordinary installed packages should use their compiled exports.

| Package         | Public capability                                                                                                   | SDK-IT decision                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testing`       | Native `test.each`/`suite.each`; disposable HTTP, streams, Docker and database fixtures; bounded async observations | Adopt the existing parameter tables and remote-security HTTP fixtures.                                                                                               |
| `fs`            | Atomic replacement, exclusive creation, durable writes, retry/error helpers, local file locks                       | Useful for scaffold and metadata safety, but changes file semantics and runtime compatibility; retain current mechanism in this removal pass.                        |
| `async`         | `untilAborted`, one-shot `Latch`, `poll`                                                                            | Cancellation waits have concrete targets; fixing them changes observable behavior and is tracked separately. No mapping, collection or concurrency-limit API exists. |
| `mutex`         | Exclusive keyed work with memory, SQLite, socket, thread and IPC stores                                             | Output-directory serialization is an additive feature, not an existing mechanism to remove.                                                                          |
| `single-flight` | Share concurrent same-key work across local processes, using a directory, codec and elected coordinator             | Not equivalent to either existing promise cache; do not substitute it.                                                                                               |
| `lease`         | Ownership-loss signal and error                                                                                     | No standalone ownership lifecycle exists in SDK-IT.                                                                                                                  |
| `election`      | Local SQLite-backed leadership terms                                                                                | No singleton coordinator service needs election.                                                                                                                     |
| `fencing`       | Monotonic tokens for resources that reject stale owners                                                             | Ordinary file writes and registry publication do not enforce such tokens.                                                                                            |
| `eslint`        | Scoped test, framework, environment and Nx policies, plus an opinionated base preset                                | Potential later policy rollout; installed ESLint 9.29 is below its 9.30 floor, and its TypeScript peer range is `<6.1`.                                              |
| `shadcn`        | Shared Base UI components, fixed nova preset, theme CSS                                                             | Existing backlog #2648 owns the migration after publication; Radix `asChild` to Base UI `render` is a behavior/visual migration.                                     |

## Removed and proven

Scope was measured before editing: five test files, eight independent case tables containing 28 rows, two positive remote-fetch fixtures, and one negative fetch guard. One initially identified pagination table was excluded because it imports the internal emitter rather than testing a public package interface.

| File                                                                                                      | Removed ownership                                                           | Executed observable                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Core schema tests](../../packages/core/src/lib/zod-jsonschema.test.ts)                                   | Five manual case loops                                                      | All 22 rows retain their original schema, optionality and metadata assertions and now report as named subtests.                                                                                                                |
| [RPC converter tests](../../packages/rpc/src/lib/zod.test.ts)                                             | One manual format loop and a relative source import                         | Both binary formats accept the existing Blob fixture through the exported `RuntimeZodConverter`.                                                                                                                               |
| [RPC characterization tests](../../packages/rpc/src/lib/zod.v4-characterization.test.ts)                  | One manual format loop                                                      | Both URL formats accept the valid URL and reject the invalid literal.                                                                                                                                                          |
| [TypeScript generation tests](../../packages/typescript/src/lib/generate.test.ts)                         | One manual runtime loop                                                     | Both generated agent-runtime projects compile without diagnostics, with independent temporary projects and cleanup.                                                                                                            |
| [Security URI tests](../../packages/spec/src/lib/processing-plugins/resolve-security-scheme-uris.test.ts) | Two fake response objects and three manual global-fetch save/restore blocks | Real loopback HTTP resolves and normalizes the security scheme, sends no fragment, and fetches a shared document exactly once. An HTTP fixture with a real `$self` base verifies that a plain component name makes no request. |

The installed export map exposes `@zukhruf/testing/node` and `@zukhruf/testing/http`. Their declarations and shipped JavaScript were read before use. `test.each` registers native Node tests and awaits their declaration promises; it adds no assertion API or runner. `HttpServer.start` binds an available loopback port and returns an async-disposable handle that closes connections and waits for shutdown. `background` was rejected because these fixtures require per-test ownership. The negative guard also uses `HttpServer.start` and asserts zero requests, with no fetch mock.

These are test refactors, so the proof is the passing baseline followed by the same behavioral assertions using the replacement mechanisms. No artificial failing production test was introduced. Product fixes remain subject to the red/green integration-test loop.

## Net delta

The five test files add 134 lines and delete 139: five fewer lines overall. This 92-line report makes the complete change 226 additions and 139 deletions, net +87. The added documentation preserves the package audit, rejected substitutions, verification boundary and follow-up ownership; no new production abstraction or dependency was added.

## Retained surface

- Public exports, schema conversion helpers, fixtures, expected literals and assertions remain. `RuntimeZodConverter` is explicitly exported by `@sdk-it/rpc`; its test now consumes that public entry point.
- Loops that construct one fixture or check properties of one result remain. They are not independent test cases. Already individually registered native tests also remain.
- The existing test files and their suite organization remain; no containing package, public extension point, documentation contract or completed ticket was removed.
- Temporary-project cleanup remains local to each generation test. No new wrapper, compatibility branch, fallback, optional escape hatch or suppression directive was introduced. A scan of added lines found no new fallback/suppression expressions.
- No new probe script was retained. Local command logs are ignored under `tmp/zukhruf-adoption`; they are not build inputs or shipped files.

## Rejected substitutions and next decisions

- **REJECTED: replace `writeFiles` wholesale with Zukhruf/fs.** `createExclusive` would close the existence-check/write race, and `atomicWrite` would protect individual files from partial contents. However, replacement changes symlink, hard-link, mode and parent-permission behavior. It does not make an entire generated directory transactional. The fs root eagerly loads `FileLock` and `node:sqlite`, even for an `atomicWrite` import; adoption through spec metadata would reach RPC's declared Node `>=22` consumers. Early Node 22 lacks that module. `createExclusive` also needs its draft-write cleanup defect fixed first (#2672).
- **REJECTED: treat prompt cancellation as an equivalent refactor.** `processSpec` can remain pending after abort when a plugin never settles, and `enrichExamples` can publish an example after abort during validation. `untilAborted` fits the waits, but does not stop callback side effects. This requires new cancellation behavior and mutation guards, tracked in #2669.
- **REJECTED: replace completed-output caching with `SingleFlight`.** Vite retains successful promises; single-flight forgets settled work. Its codec and joiner-error behavior also differ. A content-keyed flight does not serialize different generations writing one directory; an output-keyed flight can drop a newer change by joining older work. Vite's A -> B -> A stale-output defect is #2667.
- **REJECTED: add coordination merely to increase adoption.** A future output mutex should use a canonical directory key and hold through cache recheck, generation, cleanup, compilation, formatting and the success marker. The custom formatter is currently not awaited (#2668), and `Promise.all` can reject while sibling writes continue. `MemoryStore` covers one shared process; cross-process requirements would justify considering `SqliteStore`. The root mutex import still brings the SQLite dependency graph. Lease/election/fencing have no current direct replacement target.
- **REJECTED: enable the entire ESLint preset.** It changes policy beyond this scope. A read-only probe of three selected rules across 301 source files found 10 test-lifecycle hooks and no Hono-empty-array/internal-anchor violations. The TypeScript peer restriction also needs reconciling with the TS7 migration goal. Framework-integration packages must not blindly receive the upstream island policy.
- **REJECTED: mechanically migrate the UI.** There are copied components in both `packages/shadcn` and APIref. Base UI composition, nova styling, modal/focus/mobile behavior and the package-wide stylesheet need deliberate validation. Publication and #2648 are prerequisites; this audit did not exercise the UI in a browser.
- **REJECTED: replace the Docker e2e runner now.** `Docker.run` has no working-directory or live-output equivalent for `e2e/docker.ts`, adds resource/time limits, and its cleanup supervisor runs native tests rather than arbitrary Bun scripts. The root e2e command does not use that Docker script.
- **REJECTED: invent uses for remaining helpers.** `StreamHarness` could improve generated SSE runtime coverage, but there is no existing stream fixture to remove. Database fixtures have no current consumer. Zukhruf/fs has no walker or JSON loader, and async has no `p-limit` replacement. A one-shot `Latch` does not replace SSE's repeating notification lifecycle. Node-only helpers must stay out of browser-capable generated clients.

## Verification and limitations

Before editing, the four affected package typechecks and the selected existing tests passed: core 20, spec 7, RPC 81 and TypeScript 23. Each replacement group was then executed independently before the final broader checks.

| Nx project           | Full-suite pass count | Existing non-executed cases | Typecheck | Lint              |
| -------------------- | --------------------: | --------------------------- | --------- | ----------------- |
| `@sdk-it/core`       |                   195 | 62 TODO                     | Pass      | Pass, 21 warnings |
| `@sdk-it/spec`       |                   402 | 5 skipped                   | Pass      | Pass, 13 warnings |
| `@sdk-it/rpc`        |                   136 | None                        | Pass      | Pass, 28 warnings |
| `@sdk-it/typescript` |                   142 | None                        | Pass      | Pass, 16 warnings |

Full checks used `nx run <project>:test`, `:typecheck`, and `:lint` on Node 26.10.0. Because the workspace declares Node `>=24 <26`, all five changed test files were also rebuilt and executed through Nx with `--skip-nx-cache` on installed Node 24.18.0: 42 + 7 + 83 + 24 = 156 passing tests. Prettier and `git diff --check` pass. The real HTTP cases required loopback networking outside the sandbox; all fixture servers closed when their tests ended.

Old selected case loops and manual fetch assignments were searched after editing and are absent. No processes started by this operation remain. No Windows, remote Docker, browser, or unreleased-single-flight validation is claimed. **Unproven applied removals: none. Unresolved user decisions: none silently applied.** The rejected changes remain proposals or tracked defects, not completed migrations.

## Follow-ups captured

All five new records were checked against the open backlog and classified `defect / internal`.

| Backlog | Repository      | Finding and evidence boundary                                                                                                    |
| ------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| #2667   | sdk-it          | Vite A -> B -> A leaves B output; reproduced with the exact cache helper and in-memory callbacks, not a full Vite run.           |
| #2668   | sdk-it          | Custom formatter completion is not awaited; source-confirmed lifecycle gap.                                                      |
| #2669   | sdk-it          | Processing can hang or mutate examples after abort; reproduced against current built public APIs after checking source parity.   |
| #2670   | sdk-it          | `ignoreIfExists` can overwrite a concurrently created scaffold; source-backed race, no disk reproduction performed in the audit. |
| #2672   | mutex / Zukhruf | `createExclusive` skips cleanup when the initial draft write fails; injected ENOSPC probe observed no cleanup call.              |

Existing UI migration #2648 remains open. Previously completed RPC path-encoding backlog #2664 is unrelated to these new findings and remains complete.

## Requested defect fixes

The user subsequently authorized the behavior changes in #2667–#2670. These follow-up fixes supersede the corresponding deferrals above.

- **#2669:** Added `@zukhruf/async` 0.3.21 for cancellable plugin, generation and validation waits, with a post-validation abort guard. Eight parameterized public-pipeline cases proved the original hangs and late example/diagnostic writes before the fix, including non-Error abort reasons and late callback rejection. The spec suite passed 410 tests (five existing skips), plus Nx typecheck and lint. Cancellation stops waiting and suppresses built-in commits; arbitrary plugin callback side effects still require the callback to honor its signal.
- **#2668:** The custom TypeScript formatter now awaits the existing `execa` dependency and propagates child failures. Six real CLI cases cover delayed success, nonzero exit and missing executable in minimal/full modes, including installation ordering and prevention after failure. All 25 CLI tests, Nx typecheck and lint passed. Updated Node 24 type declarations to use native disposable temporary directories. Other formatter branches are tracked separately in #2679.
- **#2670:** Replaced the scaffold existence-check/write sequence with Node's exclusive `wx` creation, ignoring only `EEXIST`. Real filesystem tests reproduce the competing-writer overwrite at relative/absolute paths and the dangling-symlink case, then verify those cases plus concurrent complete winners and error propagation. All 200 core tests passed (62 existing TODOs), plus Nx typecheck and lint. Zukhruf/fs remains unnecessary for this contract and retains its separate compatibility/cleanup concerns.
- **#2667:** Replaced the permanent content-history cache with the latest queued state per normalized output directory. Different specs queue through generation and formatting; identical queued/completed work is reused, and failed predecessors cannot evict newer work. File and object inputs are snapshotted before queued execution so the fingerprint describes what is generated. Six real Vite cases failed against the original implementation and pass with the fix: object/file/function A -> B -> A, concurrent outputs, and queued A -> B -> A after success/failure. All 16 Vite tests, Nx typecheck and lint passed. `SingleFlight` remains unsuitable because completed-output caching and ordered different-input updates are required.

Final follow-up verification on Node 24.18.0: 929 passing tests across core (200), spec (410), CLI (25), Vite (16), TypeScript (142), and RPC (136); 62 existing TODOs and five existing skips. All four changed packages' Nx typechecks/lint passed, along with dependent TypeScript/RPC typechecks. The 25 new integration cases use Zukhruf case tables and bounded async observations where appropriate. Logs remain ignored under `tmp/zukhruf-fixes`. Commits stage only this work, including selective manifest/lockfile hunks, while preserving concurrent APIref/shadcn edits.

## Formatter follow-up #2679

SDK generation must wait for a selected formatter and fail if that command cannot start or exits with an error. Python and Dart custom formatter callbacks now await the existing `execa` dependency, as the TypeScript custom callback already does. Dart also exposes `--formatter`; its existing callback could not previously be selected from the CLI. The TypeScript default formatter now propagates process errors, so dependency installation cannot continue after failed formatting. `--no-default-formatter` explicitly disables TypeScript formatting. Python's optional Black/Ruff fallback policy is outside this ticket.

Zukhruf `test.each` registers 20 formatter integration cases through the package's real CLI executable: 12 custom-formatter cases across TypeScript minimal/full, Python, and Dart, plus eight default-TypeScript cases across verbose/quiet modes. The cases cover delayed success, nonzero exit, process-start failure, output paths, installation ordering, disabling formatting, and verbose output. Fourteen cases are new. Each test owns a native disposable temporary directory and uses local executable fixtures; no formatter download or dependency installation is needed.

Before the fixes, Python and Dart ignored both nonzero formatter exit and a missing executable; the Dart CLI first rejected `--formatter` itself. The default TypeScript formatter ignored both nonzero exit and an `ELOOP` process-start failure in quiet and verbose modes. Failing outputs are preserved under `tmp/zukhruf-fixes/2679-*-red.log`. After the fixes, `nx run @sdk-it/cli:test` passes all 39 tests on Node 24.18.0, and the CLI Nx typecheck/lint targets pass (three existing lint warnings). The unrelated Dart empty-document generation failure found while constructing these fixtures is tracked in #2684.

## Empty Dart document follow-up #2684

A valid OpenAPI document with `paths: {}` must still generate the base Dart SDK. The generator previously depended on writing model files to create its output directory. With no models, the file writer creates nothing, and the subsequent metadata write fails with `ENOENT`. The Dart generator now explicitly creates the output directory recursively before writing models and metadata, using native Node filesystem support.

Six Zukhruf `test.each` integration cases exercise the public `@sdk-it/dart` generator and real CLI executable with new, nested, and existing output directories. They check the generated SDK structure, empty schema indexes, metadata, normalized OpenAPI, formatting completion, and preservation of an existing manifest and README. Before the fix, both new-directory cases failed at each public entry point; the existing-directory controls passed. Red output is preserved in `tmp/zukhruf-fixes/2684-generator-red.log` and `2684-cli-red.log`.

On Node 24.18.0, all five Dart tests and 42 CLI tests pass through Nx. Both packages' Nx typecheck and lint targets pass (six existing Dart lint warnings and three CLI warnings). CLI cases use a local formatter command; this verifies generation and formatter execution without claiming Dart compiler validation. Each fixture owns a disposable temporary directory. A separate public-API probe confirmed that regeneration from a nonempty document to an empty one leaves stale API files; that cleanup defect is tracked in #2685.

## Empty Dart regeneration follow-up #2685

Regenerating an SDK from an empty document now runs cleanup even when no models are written. Cleanup still runs before indexes are rebuilt and still honors `cleanup: false`. The manifest keep rule now uses `/pubspec.yaml`, matching the normalized paths used by cleanup, so an existing manifest is preserved instead of deleted and replaced.

Three Zukhruf `test.each` integration cases generate a real SDK through `@sdk-it/dart`, then regenerate it with default, enabled, or disabled cleanup. They check removal or preservation of the old API and model files, empty input/model/output indexes, the updated client and OpenAPI document, and preservation of the customized manifest, README, build/distribution files, custom user code, and user-file rules. Each case owns a native disposable temporary directory. The default and enabled cases first reproduced the stale-file failure; enabling cleanup then exposed manifest replacement in these cases and the existing #2684 test. Both failing runs are preserved in `tmp/zukhruf-fixes/2685-generator-red.log` and `2685-preservation-red.log`.

Final verification on Node 24.18.0: all eight Dart tests and 42 CLI tests pass through Nx. Dart typecheck and lint pass (six existing warnings), and the dependent CLI typecheck passes. The production change stays in the Dart generator; no shared cleanup semantics or new dependency is introduced.

## Optional response properties #2443

The TypeScript emitter now writes `?` on properties absent from their parent schema's `required` list. Previously it computed requiredness but always wrote a required property key. Inline objects also lost the possibility of `undefined`, while optional primitive properties were written as required keys whose values could be `undefined`. The fix applies at the shared property-writing step, preserving required keys and their value types.

Five Zukhruf `test.each` integration cases call public `generate()` and compile the resulting SDK plus consumer code through the installed TypeScript compiler API under Nx's native Node test target. They cover inline objects, objects without an explicit type, component references, arrays, and dictionaries. Strict consumer checks accept omitted optional fields and nested notes, require a check before using an optional value, and reject missing required fields, missing nested IDs, wrong ID types, and null for non-nullable schemas. Each case owns a disposable temporary project. Before the fix, the inline-object consumer failed with missing-property errors and incorrectly allowed unchecked access; the failing output is preserved in `tmp/zukhruf-fixes/2443-generator-red.log`.

On Node 24.18.0, all 147 TypeScript tests and 42 CLI tests pass. Both Nx typechecks pass; TypeScript lint passes with 16 existing warnings. The expanded probes also confirmed two independent defects, retained as separate work: generated templates fail with `exactOptionalPropertyTypes` (#2687), and schema normalization removes `null` from object type arrays when properties are present (#2688). Their diagnostics, nullable fixture, and public IR probe remain under `tmp/zukhruf-fixes/2443-*`. No production change for those follow-ups is included here.

## Exact optional properties #2687

Generated requests now omit an absent abort signal and a GET body. Cursor and page pagination omit absent fields from their internal request parameters; a missing next cursor clears the previous cursor. Pagination constructors accept explicit `undefined` for optional input fields emitted by Zod, then normalize those fields before dispatch. Required request values and offset pagination's internal numeric fields retain their strict types.

Six Zukhruf `test.each` integration cases generate full and minimal SDKs with omitted, explicitly undefined, or supplied pagination parameters. Each compiles the SDK and a consumer with `strict` and `exactOptionalPropertyTypes`, then executes the generated client and pagination classes. Assertions cover prepared request fields, JSON bodies, all three pagination request forms, abort propagation, cursor clearing, page advancement, and rejection of missing or undefined required values. Each fixture owns a disposable directory and stops its bundler. The original compiler failures are preserved in `tmp/zukhruf-fixes/2687-red.log`.

On Node 24.18.0, all 153 TypeScript tests and 42 CLI tests pass through Nx. Both Nx typechecks pass, and TypeScript lint passes with its 16 existing warnings. The existing generated-client snapshots and pagination emission assertion were updated for the conditional signal fields.
