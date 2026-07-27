# Cookie Authentication

Generated SDK-IT clients use the Fetch API. Browsers and server-side frameworks
handle cookies differently: browsers need an explicit credentials policy, while
servers need the incoming cookie header forwarded to the API.

## Browsers

Pass a custom `fetch` implementation when creating the client:

```typescript
import { Client } from '@acme/client';

export const client = new Client({
  baseUrl: 'https://api.example.com',
  fetch: (request) => fetch(request, { credentials: 'include' }),
});
```

`credentials: 'include'` sends cookies to same-origin and cross-origin APIs.
For same-origin APIs only, use `credentials: 'same-origin'`.

For a cross-origin API, its CORS response must also allow credentials and name
the frontend origin instead of using `*`. Cookie attributes such as `Domain`,
`SameSite`, and `Secure` remain the API's responsibility.

React Query does not need a separate cookie option. It uses the configured SDK
client; see the [React Query integration](../react-query.md#including-cookies).

## Server-side frameworks

A server-side `fetch` does not automatically inherit the visitor's browser
cookies. Read the `cookie` header from the incoming request and pass it through
the SDK's per-request headers:

```typescript
import { Client } from '@acme/client';

const client = new Client({
  baseUrl: 'https://api.example.com',
});

export async function loadAccount(request: Request) {
  const cookie = request.headers.get('cookie');

  return client.request(
    'GET /account',
    {},
    {
      headers: cookie ? { cookie } : {},
    },
  );
}
```

This standard `Request` pattern works in route handlers, loaders, actions, and
other request-scoped server APIs. Adapt only the framework-specific step that
provides the incoming `Request`.

Keep authentication headers request-scoped. Do not write a visitor's cookie
into a process-wide client with `setOptions`, because concurrent requests could
send one user's session to another user's API call.
