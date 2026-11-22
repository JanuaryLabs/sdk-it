# The sync generator is the only writer of a derived document

Status: proposed (#5158)

## Context

`@sdk-it/openapi` ADR 0006 made every reader rewrite the committed derived document when its bytes differ. In a shared checkout that leaves a tracked file dirty after any typecheck or dev server, and no commit writes it: meddit's b66f673 committed a backend change without its document, and 943f2a5 fixed it by hand. No reader uses the committed bytes; they derive the document in memory. A survey of the 19 repos that use sdk-it found the same failure wherever a derived file is committed and regenerated outside the commit.

## Decision

Readers derive the document in memory and write nothing. The `openapi-sync` Nx sync generator is the only writer: `nx sync` writes each stale document, a pre-commit hook that runs `nx sync` stages it into the commit that changed the backend, and `nx sync:check` fails a push that holds a stale one.

## Consequences

- A typecheck, an editor session or a dev server never dirties the tree.
- A stale committed document cannot reach main through a hook-checked commit, and CI reports one that bypassed the hook.
- `@sdk-it/openapi` ADR 0006's "rewrites the committed document" is replaced by this decision.
- TypeScript maps each generated name into the bytes of the committed file (go to definition, diagnostics), and those bytes differ from the derivation while the file is stale. The content mapper renders from the derivation and locates each name in the committed bytes: a name the committed copy declares keeps its definition, and a name it does not declare yet has none until `nx sync` writes it. Before, a reader's rewrite hid this: mapping into the derivation's offsets against a stale file is a transform TypeScript rejects (TS18069). (Found in the build, 2026-11-22.)
