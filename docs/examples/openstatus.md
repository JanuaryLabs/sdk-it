# OpenStatus API Example

This example demonstrates how to use the SDK-IT generated client for [OpenStatus](https://www.openstatus.dev/), an open-source synthetic monitoring tool.

## Setup

### Generate the SDK

First, generate the SDK using the CLI:

```bash
npx @sdk-it/cli@latest typescript \
  --spec https://api.openstatus.dev/v1/openapi \
  --output ./openstatus \
  --name OpenStatus \
  --mode full
```

### Create and configure Client

```typescript
import { OpenStatus } from './openstatus';

// Initialize the client with your API key
const openstatus = new OpenStatus({
  baseUrl: 'https://api.openstatus.dev/v1',
  'x-openstatus-key': process.env.OPENSTATUS_API_KEY,
});
```

### Create Monitor

```typescript
const [monitor, error] = await openstatus.request('POST /monitor', {
  body: {
    name: 'My Website Monitor',
    url: 'https://example.com',
    periodicity: '5m',
    regions: ['ams', 'nyc'],
    method: 'GET',
    assertions: [
      {
        type: 'status',
        compare: 'eq',
        target: 200,
      },
    ],
    active: true,
  },
});

if (error) {
  console.error('Failed to create monitor:', error);
} else {
  console.log('Monitor created:', monitor);
}
```

### Get Monitor Status

```ts
const [status, error] = await openstatus.request('GET /monitor/{monitorId}', {
  params: {
    monitorId,
  },
});

if (error) {
  console.error('Failed to get monitor status:', error);
} else {
  console.log('Monitor status:', status);
}
```

### Create Status Page

```typescript
const [page, error] = await openstatus.request('POST /page', {
  body: {
    name: 'My Service Status',
    description: 'Current status of our services',
    slug: 'my-service-status',
    subdomain: 'status',
    isPublic: true,
  },
});

if (error) {
  console.error('Failed to create status page:', error);
} else {
  console.log('Status page created:', page);
}
```

### Report Incident

```typescript
const [incident, error] = await openstatus.request('POST /incident', {
  body: {
    title: 'Service Degradation',
    status: 'investigating',
    impact: 'minor',
    message: 'We are investigating reports of increased latency',
    pageId: 123, // Your status page ID
  },
});

if (error) {
  console.error('Failed to report incident:', error);
} else {
  console.log('Incident reported:', incident);
}
```
