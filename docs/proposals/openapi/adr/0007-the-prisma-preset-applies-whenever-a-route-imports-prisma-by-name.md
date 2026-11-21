# The Prisma preset applies whenever a route imports Prisma by name

Status: accepted (user, 2026-11-21)

## Context

The CLI's `preset: 'auto' | 'prisma' | 'none'`:

- `'auto'` applies the Prisma preset when a source file imports `Prisma` or `$Enums` by name.
- `'prisma'` fails when no such import exists.
- `'none'` skips the preset.

Only factory's config sets `preset` (`'prisma'`), which `'auto'` already covers. An `against` that reads `$Enums` without the preset fails analysis, so `'none'` with such an import is a broken state.

## Decision

The preset applies whenever a route file imports `Prisma` or `$Enums` by name, and there is no `preset` option. Other named imports go in `allowedNamedImports`. The preset's error is `PrismaClientNotGeneratedError`, a class of its own, because the next step (run Prisma generate) differs from any other failed import.

## Consequences

- factory's `preset: 'prisma'` no longer type-checks; its migration deletes it.
- The string hint appended to `UnloadedImportError` becomes a typed error.
