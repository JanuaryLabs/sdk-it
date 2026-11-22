# A backend that does not analyze fails the sync

Status: proposed (#5158)

## Context

A derived document can fail to derive: its definition module does not load, or `generateDocument` throws (an unresolved type, a missing generated Prisma client). The readers report this as diagnostic `sdk-it4`. A sync generator can either report the document as out of sync or throw.

## Decision

The generator throws an error that names the document and gives the analysis message. `nx sync` and `nx sync:check` then fail with it, as `@nx/js:typescript-sync` fails with its `SyncError` for a workspace it cannot read.

## Consequences

- A commit or a CI run on a backend that does not analyze stops with the reason, instead of keeping a document that no longer matches.
- A hook whose snapshot lacks gitignored generated code must run the targets that write it first (zukhruf `Sync`'s `before`, #5360).
