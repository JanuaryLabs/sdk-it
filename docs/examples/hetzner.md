# Build a Hetzner Cloud SDK

## Generate the SDK

Inside an existing TypeScript project:

```bash
npm install zod fast-content-type-parse

npx @sdk-it/cli@latest generate typescript \
  --spec https://raw.githubusercontent.com/MaximilianKoestler/hcloud-openapi/refs/heads/main/openapi/hcloud.json \
  --output ./src/generated/hetzner \
  --name Hetzner \
  --package-name @acme/hetzner \
  --mode minimal
```

## Create the client

```typescript
import { createHetzner } from './src/generated/hetzner/index.ts';

const hetzner = createHetzner({
  baseUrl: 'https://api.hetzner.cloud/v1',
  credentials: {
    APIToken: process.env.HETZNER_API_TOKEN,
  },
});
```

The specification names two servers, so `baseUrl` is necessary.

## Get all servers

```typescript
const result = await hetzner.request('GET /servers', {});

console.log(`Total servers: ${result.meta.pagination.total_entries}`);
for (const server of result.servers) {
  console.log(`Server: ${server.name} (ID: ${server.id})`);
  console.log(`- Status: ${server.status}`);
  console.log(`- Type: ${server.server_type.name}`);
  console.log(`- IP: ${server.public_net.ipv4.ip}`);
}
```

## Create a server

```typescript
const result = await hetzner.request('POST /servers', {
  name: 'my-server-name',
  server_type: 'cx23',
  image: 'ubuntu-24.04',
  location: 'nbg1',
  ssh_keys: ['12345'],
  start_after_create: true,
});

console.log(`Server created: ${result.server.id}`);
console.log(`Status: ${result.server.status}`);
console.log(`Root password: ${result.root_password}`);
```

## Power on a server

```typescript
const result = await hetzner.request('POST /servers/{id}/actions/poweron', {
  id: 42,
});

console.log(`Action: ${result.action.id}`);
console.log(`Status: ${result.action.status}`);
```

## Create a snapshot

```typescript
const result = await hetzner.request(
  'POST /servers/{id}/actions/create_image',
  {
    id: 42,
    description: 'My server snapshot',
    type: 'snapshot',
  },
);

if (!result.image || !result.action) {
  throw new Error('Hetzner did not return the created image and action');
}

console.log(`Image: ${result.image.id}`);
console.log(`Description: ${result.image.description}`);
console.log(`Action status: ${result.action.status}`);
```

## List volumes

```typescript
const result = await hetzner.request('GET /volumes', {});

console.log(`Total volumes: ${result.meta.pagination.total_entries}`);
for (const volume of result.volumes) {
  console.log(`Volume: ${volume.name} (ID: ${volume.id})`);
  console.log(`- Size: ${volume.size} GB`);
  console.log(`- Server: ${volume.server ?? 'Not attached'}`);
}
```
