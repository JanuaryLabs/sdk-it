# Overview docs: `x-docs` and `x-sdks`

SDK-IT generates an **Overview** section for the API reference and the README
from the OpenAPI document: an overview page, an authorization page, and an
errors page. Two top-level extensions let a spec author shape that section.

## `x-sdks`: the getting-started box

List the published SDKs. The overview page renders an install command and a
link for each one.

```yaml
x-sdks:
  - language: typescript
    package: '@acme/sdk'
  - language: python
    package: acme
    url: https://acme.dev/docs/python
```

| language     | install                  | default link                              |
| ------------ | ------------------------ | ----------------------------------------- |
| `typescript` | `npm install <package>`  | `https://www.npmjs.com/package/<package>` |
| `python`     | `pip install <package>`  | `https://pypi.org/project/<package>`      |
| `dart`       | `dart pub add <package>` | `https://pub.dev/packages/<package>`      |

`url` overrides the default link. Omit `x-sdks` and the box is omitted.

## `x-docs`: seed or add pages

```yaml
x-docs:
  - id: overview
    title: Getting started
    description: Everything you need to make your first request.
  - title: Rate limits
    content: |
      Every key gets 100 requests per minute.
```

Each entry resolves to an id: `id` when given, otherwise the title, both
slugified (`Rate limits` becomes `rate-limits`).

- **Matches a generated page** (`overview`, `authorization`, `errors`): the
  entry seeds it. Its title becomes the page title and heading, its
  description the lead paragraph, its content follows, and the generated body
  comes last.
- **No match**: a new page in the Overview section at `/<id>`. `content` is
  the body and falls back to `description`.

Rules: `title` is required; a custom page needs `content` or `description`;
`embed` is reserved; when two entries resolve to the same id the first wins.
Violations are reported as `warning` diagnostics (`invalid-x-docs`,
`reserved-x-docs-id`, `duplicate-x-docs-id`, `invalid-x-sdks`) and the entry
is skipped. Read them from `processSpec` or `toIR({ onDiagnostic })`.

## Where it shows up

- **API reference** (`@sdk-it/apiref`): the overview page is the landing route
  `/`. Every other page lives at its url, and all of them sit under "Overview"
  in the sidebar.
- **README** (`sdk-it readme`): the overview page opens the README, followed by
  the authorization and errors pages and the operation reference.
- **IR**: after processing, `x-docs` holds the sidebar data (`SidebarData`) and
  `x-sdks` the validated SDK list. Both are empty arrays when the
  `extract-overview-docs` plugin is not part of the pipeline.
