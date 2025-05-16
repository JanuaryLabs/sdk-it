# Release Notes Writing Instructions

These guidelines ensure every release note is clear, concise, and useful.

## Template

Use this exact structure for each release. Insert your version and date in the first line:


## Rules

1. **Imperative mood**
   Start each bullet with a verb: “Add”, “Fix”, “Remove”, never past tense.

2. **One sentence per bullet**
   Keep it to a single, focused sentence. If you need more context, link to docs.

3. **Reference IDs**
   Always end with the issue or PR number in parentheses, e.g. `(#1234)`.

4. **Header order**
   Always use headings in this order:
   `Added` → `Changed` → `Fixed` → `Deprecated` → `Removed` → `Security`.

5. **Breaking changes**
   Under `Changed` or `Deprecated`, call out any migrations or API changes.

6. **Semantic versioning**
   Version header must follow `MAJOR.MINOR.PATCH` (e.g. `1.2.0`).

7. **Top-append**
   When updating for a new release, insert the entire block above all existing entries.

## Example

