# The analysis prefixes each path with the base path its router mounts on

Status: accepted (user, 2026-11-21: "Fix it in this work")

## Context

The analysis matches routes by shape (`X.<method>(path, …)`) and writes each path as written (`#tunePath` only turns `:param` into `{param}`). It never applies `app.basePath(p)` or `app.route(p, sub)`.

meddit registers every route module on `app.basePath('/api')`, passed in as a parameter:

```ts
for await (const route of [import('./routes/drugs.route.ts'), …]) {
  route.default(app.basePath('/api'));
}
// drugs.route.ts
export default function (router: Hono): void {
  router.get('/drugs/search', …);
}
```

The document says `/drugs/search`, but the server answers `/api/drugs/search`. meddit compensates with `createBackend({ baseUrl: '/api' })` and a comment that "the sdk-it analyzer cannot see" the prefix.

## Decision

The analysis follows where the receiver of a route call comes from, and prefixes the route's path with every base path on the way:

- `const api = app.basePath('/api')`, then `api.get('/x')`, documents `/api/x`.
- `app.route('/admin', admin)`, where `admin.get('/users')` is registered, documents `/admin/users`.
- A route function's parameter (`export default function (router: Hono)`) takes the base path of each argument it is called with (`route.default(app.basePath('/api'))`), through the program's call sites.
- A receiver whose base path the analysis cannot tell (passed from outside the program) keeps the path as written.

RED test from meddit's shape first.

## Consequences

- meddit's client uses `baseUrl: '/'`, and the comment goes.
- A route function called with two different base paths documents its routes under both.
