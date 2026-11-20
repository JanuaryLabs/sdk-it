# The component name a URI reference gives, in two places

When the spec loader brings in a value that a URI reference points to, it registers the value under a name in a components section. Two places derive that name from the reference the same way. They keep one copy each, and do not share it yet.

The reason is the Rule of Three. Code that a second place needs is copied, and it is extracted only when a third place needs it, so the boundary of the shared code comes from three working copies, not from a guess. Until then, a fix in one copy is made in the other copy too, and the commit names both files (backlog #4921).

## The copies

| Place                                                                                                                      | Function                                              | Fallback                 |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------ |
| `src/lib/bundling/external-ref-bundler.ts`: an external `$ref` target hoisted into a components section                    | `componentName(reference, section)` and `lastSegment` | `external-<section>`     |
| `src/lib/bundling/external-security-schemes.ts`: the Security Scheme Object behind an OpenAPI 3.2 security requirement URI | `schemeName(uri)` and `lastSegment`                   | `externalSecurityScheme` |

Both take the last segment of the reference's JSON Pointer fragment. Without one, they take the last path segment of the document location, without its query and without a `.json`, `.yaml` or `.yml` extension. They keep only `a-z`, `A-Z`, `0-9`, `.`, `_` and `-`, and use the fallback when nothing is left.

## What differs

- The fallback: a hoisted target names its section, a security scheme has a fixed name.
- `componentName` takes a `Reference`, `schemeName` takes the URI text and builds the `Reference` itself.

## When a third place needs it

Derive the shared part from the three copies. The candidate name is likely a method of `Reference` (`src/lib/documents/reference.ts`), with the fallback staying with each caller. Switch every copy to it, delete the copies and this note, and close #4921.
