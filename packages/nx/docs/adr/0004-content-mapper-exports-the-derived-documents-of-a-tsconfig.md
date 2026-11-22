# The content mapper exports DerivedDocument, a document derived from a definition

Status: accepted (user, 2026-11-22, #5158)

## Context

`@sdk-it/content-mapper` owns what a `derived` entry means. Its internal `DerivedDocuments` mixes four jobs: the declaration (a tsconfig's document-to-definition map), the derivation (import the definition, `generateDocument`, serialize), a cache of each document's last state for the TypeScript server's `transform`, and today the writing. The generator must derive the same bytes as the readers, so it must call the same code, but it needs neither the cache nor the writing.

## Decision

The package exports one value class for one document and the derivation it yields:

```ts
export class DerivedDocument {
  readonly path: string; // the committed document
  readonly definition: string; // the backend's definition module
  static declaredBy(tsconfig: string): Promise<DerivedDocument[]>;
  static at(path: string): Promise<DerivedDocument | undefined>;
  derive(): Promise<Derivation>;
}

export type Derivation =
  | {
      readonly kind: 'derived';
      readonly text: string;
      readonly sources: readonly string[];
    }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly sources: readonly string[];
    };
```

- `declaredBy(tsconfig)`: each document that tsconfig's `contentMappers[].options.derived` declares.
- `at(path)`: the declaration that names `path`, from the first `tsconfig*.json` that declares it, up to the package root (what Vite and Node use).
- `derive()`: the document as the backend produces it now, serialized once for every caller; `sources` are the definition module and every file the analysis read. It writes nothing.

The TypeScript server keeps its own map of each document's last `Derivation` for `transform`. The internal `DerivedDocuments` class and `derivedDocumentsOf` go.

## Consequences

- The committed bytes are, by construction, what `tsc` and Vite derive.
- Each caller takes only what it needs: the generator `declaredBy` and `derive`, `renderImport` `at` and `derive`, the server `declaredBy` and its own cache.
