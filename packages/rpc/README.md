# @sdk-it/rpc

Create a runtime HTTP client or AI SDK tools directly from an OpenAPI
document, without generating source files.

Requires Node.js 22 or newer.

## Install

```bash
npm install @sdk-it/rpc
```

## Call an operation

```typescript
import { rpc } from '@sdk-it/rpc';

const client = await rpc('./openapi.yaml', {
  baseUrl: 'https://api.example.com',
  token: () => process.env.EXAMPLE_API_TOKEN!,
});

const response = await client.request('GET /users', {
  limit: 20,
});

console.log(response.status, response.data);
```

The endpoint key is the uppercase HTTP method followed by the OpenAPI path.
Inputs are validated before dispatch. Non-success HTTP responses throw an
`APIError` subclass; successful calls return an `APIResponse` with `status`,
`headers`, and `data`.

Use `createRpc(ir, options)` instead when you already have a processed
[`IR`](../spec/README.md).

## Create AI SDK tools

`toAgents` groups operations by OpenAPI tag and turns them into AI SDK tools:

```typescript
import { toAgents } from '@sdk-it/rpc';

const agents = await toAgents('./openapi.yaml', {
  baseUrl: 'https://api.example.com',
  useTools: 'defined',
});

const userTools = agents.users.tools;
```

With `useTools: 'defined'`, only operations carrying SDK-IT's `x-tool`
metadata are exposed.
