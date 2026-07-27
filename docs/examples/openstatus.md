# Build an OpenStatus SDK

This example uses the generated client for
[OpenStatus](https://www.openstatus.dev/), an open-source synthetic monitoring
service.

## Generate the SDK

Inside an existing TypeScript project:

```bash
npm install zod fast-content-type-parse

npx @sdk-it/cli@latest generate typescript \
  --spec https://api.openstatus.dev/v1/openapi \
  --output ./src/generated/openstatus \
  --name OpenStatus \
  --mode minimal
```

## Create the client

```typescript
import { OpenStatus } from './src/generated/openstatus/index.ts';

const openstatus = new OpenStatus({
  baseUrl: 'https://api.openstatus.dev/v1',
  'x-openstatus-key': process.env.OPENSTATUS_API_KEY,
});
```

## Create an HTTP monitor

```typescript
const monitor = await openstatus.request('POST /monitor/http', {
  name: 'My Website Monitor',
  frequency: '5m',
  regions: ['ams', 'ewr'],
  request: {
    method: 'GET',
    url: 'https://example.com',
  },
  assertions: [
    {
      kind: 'statusCode',
      compare: 'eq',
      target: 200,
    },
  ],
  active: true,
});

console.log('Monitor created:', monitor);
```

## Get a monitor

```typescript
const monitor = await openstatus.request('GET /monitor/{id}', {
  id: '42',
});

console.log('Monitor:', monitor);
```

## Create a status page

```typescript
const page = await openstatus.request('POST /page', {
  title: 'My Service Status',
  description: 'Current status of our services',
  slug: 'my-service-status',
  monitors: [42],
  accessType: 'public',
});

console.log('Status page created:', page);
```

## Report an incident

OpenStatus represents incidents announced on a status page as status reports:

```typescript
const report = await openstatus.request('POST /status_report', {
  title: 'Service degradation',
  message: 'We are investigating reports of increased latency.',
  status: 'investigating',
  pageId: 123,
  monitorIds: [42],
});

console.log('Status report created:', report);
```
