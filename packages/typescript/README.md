# @sdk-it/typescript

Generate a fully typed TypeScript client from an OpenAPI document. Generated
clients work in Node.js, browsers, and other JavaScript runtimes with `fetch`.

## Install

```bash
npm install --save-dev @sdk-it/typescript
npm install zod fast-content-type-parse
```

`zod` and `fast-content-type-parse` are runtime dependencies of clients
generated in `minimal` mode.

## Generate from an OpenAPI document

```typescript
import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

const { spec } = await loadSpec('https://api.openstatus.dev/openapi.yaml');

await generate(spec, {
  output: './src/generated/openstatus',
  mode: 'minimal',
  name: 'OpenStatus',
});
```

`loadSpec` accepts a URL or a local path and reads JSON or YAML. `name`
sets the names of the generated exports, such as `createOpenStatus` and
`OpenStatusEndpoints`. `minimal` mode writes client source
files directly to `output`.

## Render the SDK in memory

`render` returns the SDK source files and does not read or write the disk. Use
it when a tool needs the code but not the files, for example a compiler plugin.

```typescript
import { render } from '@sdk-it/typescript';

const files = await render(spec, {
  name: 'OpenStatus',
  style: { name: 'github' },
  useTsExtension: true,
});
// files['client.ts'], files['index.ts'], files['models/index.ts'], …
```

The keys are paths relative to the SDK source folder. The result contains the
index files. `generate` writes the same source files to `output`.

## Use the generated client

```typescript
import { createOpenStatus } from './src/generated/openstatus/index.ts';

const client = createOpenStatus({
  credentials: {
    ApiKeyAuth: process.env.OPENSTATUS_API_KEY,
  },
});

const reports = await client.request(
  'POST /rpc/openstatus.status_report.v1.StatusReportService/ListStatusReports',
  {},
);
console.log(reports);
```

`create<Name>(settings)` returns a client. The settings are `baseUrl`,
`headers`, `credentials`, `fetch`, and `skipValidation`.

When the spec names one server or no servers, the SDK also exports a default
instance with no settings. Its name is `<Name>` in camel case, such as
`openStatus`. Without servers, its `baseUrl` is `/`, as OpenAPI 3.2 specifies.
When the spec names two or more servers, the SDK has no default instance, and
`create<Name>` requires `baseUrl`.

```typescript
import { openStatus } from './src/generated/openstatus/index.ts';

openStatus.setOptions({
  credentials: { ApiKeyAuth: process.env.OPENSTATUS_API_KEY },
});
```

`baseUrl` can be absolute or relative, such as `'/api'`. A relative `baseUrl` resolves against the page location (`globalThis.location`). Where there is no page location, as in Node.js or React Native, a request with a relative `baseUrl` rejects with a `TypeError`. Use an absolute URL there.

## Security credentials

Credential keys are the exact names from `components.securitySchemes`.
Generated types enforce the value required by each scheme:

- API keys, Bearer/custom HTTP, OAuth 2, and OpenID Connect use a string.
- HTTP Basic uses `{ username, password }`.
- Mutual TLS uses `true`; the configured `fetch` implementation owns the
  client certificate.

Any scheme also accepts `true` to declare a transport-owned credential: the
requirement counts as satisfied and the client sets nothing, because something
outside it supplies the credential. That is the configuration for a browser
session cookie (`apiKey` with `in: cookie`; the browser sends it when the
configured `fetch` passes `credentials: 'include'`) and for a host proxy that
injects `Authorization` on the client's behalf:

```typescript
const client = createExample({
  baseUrl: '/api',
  fetch: (request) => fetch(request, { credentials: 'include' }),
  credentials: { session: true },
});
```

Each value may instead be a sync or async provider. Providers receive the
scheme name plus the current operation's OpenAPI scopes or roles:

```typescript
const client = createExample({
  baseUrl: 'https://api.example.com',
  credentials: {
    oauth: async ({ scopes }) => issueToken(scopes),
    bearer: ({ roles }) => tokenForRoles(roles),
  },
});
```

The client preserves OpenAPI security semantics: alternatives in the security
array are OR, schemes inside one requirement are AND, `security: []` sends no
credentials, and an empty requirement (`{}`) permits anonymous access. When
anonymous and authenticated alternatives coexist, configured authentication
is preferred.

`request` returns unwrapped response data. It throws `ParseError` when input
validation fails and an `APIError` subclass when the server returns a
non-successful response:

```typescript
import {
  APIError,
  ParseError,
  createOpenStatus,
} from './src/generated/openstatus/index.ts';

const client = createOpenStatus({
  credentials: {
    ApiKeyAuth: process.env.OPENSTATUS_API_KEY,
  },
});

try {
  const report = await client.request(
    'POST /rpc/openstatus.status_report.v1.StatusReportService/GetStatusReport',
    { id: '42' },
  );
  console.log(report);
} catch (error) {
  if (error instanceof ParseError) {
    console.error(error.data);
  } else if (error instanceof APIError) {
    console.error(error.status, error.data);
  } else {
    throw error;
  }
}
```

## Page through results

When an operation has pagination, `client.request` resolves to a page. A page
has the fields of the response body, such as `page.items`, and these methods:

- `hasNextPage()` tells if there is a next page.
- `getNextPage({ signal })` fetches the next page and returns it as a new page.
- `iterPages({ signal })` yields the current page, then each next page.

The `signal` option is optional. Iterate a page, or the result of
`client.request` without `await`, to get each item of all pages. In this
example, `GET /items` is an operation with pagination:

```typescript
for await (const item of client.request('GET /items', { limit: 20 })) {
  console.log(item);
}
```

## Format generated code

`formatCode` runs after generation and receives the actual source directory plus
an environment with local package executables on `PATH`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { generate } from '@sdk-it/typescript';

const execFileAsync = promisify(execFile);
const spec = await fetch('https://petstore.swagger.io/v2/swagger.json').then(
  (response) => response.json(),
);

await generate(spec, {
  output: './src/generated/petstore',
  name: 'PetStore',
  formatCode: async ({ output, env }) => {
    await execFileAsync('prettier', [output, '--write'], { env });
  },
});
```

## Generate a standalone project

`full` mode adds `package.json` and `tsconfig.json`, places generated source
under `<output>/src`, and records the generated client's runtime dependencies:

```typescript
await generate(spec, {
  output: './generated/petstore',
  mode: 'full',
  name: 'PetStore',
  packageName: '@acme/petstore',
});
```

## Framework integrations

- [React Query](../../docs/react-query.md)
- [Angular](../../docs/angular.md)
