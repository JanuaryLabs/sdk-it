## Build Hetzner Cloud SDK

### Generate SDK

```bash
npx @sdk-it/cli@latest \
  --spec https://docs.hetzner.cloud/spec.json \
  --output ./hetzner \
  --name Hetzner \
  --mode full
```

### Create and configure Client

```ts
import { Hetzner } from './hetzner';

const hetzner = new Hetzner({
  baseUrl: 'https://api.hetzner.cloud/v1',
  token: process.env.HETZNER_API_TOKEN,
});
```

### Get All Servers

```ts
const [result, error] = await hetzner.request('GET /servers', {});

if (!error) {
  console.log(`Total servers: ${result.meta.pagination.total_entries}`);
  for (const server of result.servers) {
    console.log(`Server: ${server.name} (ID: ${server.id})`);
    console.log(`- Status: ${server.status}`);
    console.log(`- Type: ${server.server_type.name}`);
    console.log(`- IP: ${server.public_net.ipv4.ip}`);
  }
} else {
  console.error(error);
}
```

### Create a New Server

```ts
const [result, error] = await hetzner.request('POST /servers', {
  name: 'my-server-name',
  server_type: 'cx11',
  image: 'ubuntu-22.04',
  location: 'nbg1',
  ssh_keys: ['12345'],
  start_after_create: true,
});

if (!error) {
  console.log(`Server created successfully!`);
  console.log(`- ID: ${result.server.id}`);
  console.log(`- Status: ${result.server.status}`);
  console.log(`- Root password: ${result.root_password}`); // Only provided on creation
} else {
  console.error(error);
}
```

### Power On/Off Server

```ts
const [result, error] = await hetzner.request(
  'POST /servers/{id}/actions/poweron',
  {
    id: 42,
  },
);

if (!error) {
  console.log(`Power on action initiated successfully`);
  console.log(`- Action ID: ${result.action.id}`);
  console.log(`- Status: ${result.action.status}`);
} else {
  console.error(error);
}
```

### Create a Snapshot

```ts
const [result, error] = await hetzner.request(
  'POST /servers/{id}/actions/create_image',
  {
    id: 42,
    description: 'My server snapshot',
    type: 'snapshot',
  },
);

if (!error) {
  console.log(`Snapshot creation initiated`);
  console.log(`- Image ID: ${result.image.id}`);
  console.log(`- Image name: ${result.image.description}`);
  console.log(`- Action status: ${result.action.status}`);
} else {
  console.error(error);
}
```

### List Volumes

```ts
const [result, error] = await hetzner.request('GET /volumes', {});

if (!error) {
  console.log(`Total volumes: ${result.meta.pagination.total_entries}`);
  for (const volume of result.volumes) {
    console.log(`Volume: ${volume.name} (ID: ${volume.id})`);
    console.log(`- Size: ${volume.size} GB`);
    console.log(`- Server: ${volume.server || 'Not attached'}`);
  }
} else {
  console.error(error);
}
```
