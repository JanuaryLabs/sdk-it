# Build an OpenStatus SDK

This example uses the generated client for
[OpenStatus](https://www.openstatus.dev/), an open-source synthetic monitoring
service.

OpenStatus v2 is a Connect-RPC API: every operation lives under
`/rpc/<package>.<Service>/<Method>` and takes its input as a request body.
Operations that read data expose both `GET` and `POST`; the `POST` form takes
the request fields directly, so the examples below use it.

## Generate the SDK

Inside an existing TypeScript project:

```bash
npm install zod fast-content-type-parse

npx @sdk-it/cli@latest generate typescript \
  --spec https://api.openstatus.dev/openapi.yaml \
  --output ./src/generated/openstatus \
  --name OpenStatus \
  --mode minimal
```

## Create the client

The v2 document declares no servers, so pass `baseUrl` explicitly:

```typescript
import { OpenStatus } from './src/generated/openstatus/index.ts';

const openstatus = new OpenStatus({
  baseUrl: 'https://api.openstatus.dev',
  credentials: {
    ApiKeyAuth: process.env.OPENSTATUS_API_KEY,
  },
});
```

## Create an HTTP monitor

```typescript
const monitor = await openstatus.request(
  'POST /rpc/openstatus.monitor.v1.MonitorService/CreateHTTPMonitor',
  {
    monitor: {
      name: 'My Website Monitor',
      url: 'https://example.com',
      method: 'HTTP_METHOD_GET',
      periodicity: 'PERIODICITY_5M',
      regions: ['REGION_FLY_AMS', 'REGION_FLY_EWR'],
      active: true,
      statusCodeAssertions: [
        { comparator: 'NUMBER_COMPARATOR_EQUAL', target: 200 },
      ],
    },
  },
);

console.log('Monitor created:', monitor);
```

Enum-valued fields use the protobuf spelling — `HTTP_METHOD_GET`,
`PERIODICITY_5M`, `REGION_FLY_AMS`. The generated types list every accepted
member.

## Get a monitor

```typescript
const monitor = await openstatus.request(
  'POST /rpc/openstatus.monitor.v1.MonitorService/GetMonitor',
  { id: '42' },
);

console.log('Monitor:', monitor);
```

## Create a status page

```typescript
const page = await openstatus.request(
  'POST /rpc/openstatus.status_page.v1.StatusPageService/CreateStatusPage',
  {
    title: 'My Service Status',
    slug: 'my-service-status',
    description: 'Current status of our services',
    accessType: 'PAGE_ACCESS_TYPE_PUBLIC',
  },
);

console.log('Status page created:', page);
```

## Report an incident

OpenStatus represents incidents announced on a status page as status reports:

```typescript
const report = await openstatus.request(
  'POST /rpc/openstatus.status_report.v1.StatusReportService/CreateStatusReport',
  {
    title: 'Service degradation',
    message: 'We are investigating reports of increased latency.',
    status: 'STATUS_REPORT_STATUS_INVESTIGATING',
    pageId: '123',
    date: new Date().toISOString(),
  },
);

console.log('Status report created:', report);
```
