# The content mapper exports the derived documents of a tsconfig

Status: proposed (#5158)

## Context

`@sdk-it/content-mapper` owns what a `derived` entry means: `DerivedDocuments` resolves each document and its definition module from a tsconfig's directory and derives the document (`derived-documents.ts`), and `derived-declaration.ts` reads the option. Both are internal. The generator must derive the same bytes as the readers, so it must use the same code, not a copy.

## Decision

`@sdk-it/content-mapper` exports `DerivedDocuments`, with a static `DerivedDocuments.declaredBy(tsconfig)` that reads that tsconfig's `derived` entry (undefined when it has none). `documents` lists each document's path; `refresh(document)` derives it and returns `{ kind: 'document', text, watched }` or `{ kind: 'failed', message, watched }`, writing nothing.

```ts
import { DerivedDocuments } from '@sdk-it/content-mapper';

const derived = await DerivedDocuments.declaredBy(
  '/repo/apps/web/tsconfig.app.json',
);
for (const document of derived?.documents ?? []) {
  const state = await derived.refresh(document);
  // state.kind === 'document': state.text is the bytes to commit
}
```

## Consequences

- One serialization for readers and writer: the committed bytes are what `tsc` and Vite derive.
- The content mapper's public API grows by one class; its readers keep using it internally.
