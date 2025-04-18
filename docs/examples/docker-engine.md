## Build Docker Engine SDK

### Generate SDK

```bash
npx @sdk-it/cli@latest typescript \
  --spec https://docs.docker.com/reference/api/engine/version/v1.48.yaml \
  --output ./dockerengine \
  --name DockerEngine \
  --mode full
```

### Create and configure Client

```ts
import Modem from 'docker-modem';
import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

import { DockerEngine } from './dockerengine';

const modem = new Modem();
const docker = new DockerEngine({
  baseUrl: 'http://localhost',
  fetch: (request) => {
    const url = new URL(request.url);
    return new Promise((resolve, reject) => {
      modem.dial(
        {
          path: request.url.replace('http://localhost', ''),
          method: request.method,
          options: {
            _body: request.body,
            _query: url.searchParams,
          },
          isStream: true,
          headers: { ...request.headers } as any,
        },
        (err, data) => {
          if (err) {
            return reject(err);
          }
          if (data instanceof IncomingMessage) {
            return resolve(
              new Response(Readable.toWeb(data) as ReadableStream<Uint8Array>, {
                status: data.statusCode,
                statusText: data.statusMessage,
                headers: new Headers(data.headers as any),
              }),
            );
          }
          throw new Error('Unexpected response');
        },
      );
    });
  },
});
```

### Get Version

```ts
const [result, error] = await docker.request('GET /version', {});
if (!error) {
  console.log(result);
} else {
  console.error(error);
}
```

### Stream logs from a container

```ts
const [result, error] = await docker.request('GET /containers/{id}/logs', {
  id: '1daf90ceeee2',
  follow: true,
  stdout: true,
  stderr: true,
});
if (!error) {
  const decoder = new TextDecoder();
  for await (const chunk of result) {
    console.log(decoder.decode(chunk as Uint8Array));
  }
}
```

### Demux container logs

```ts
const [result, error] = await docker.request('GET /containers/{id}/logs', {
  id: '3b85714a4095',
  follow: true,
  stdout: true,
  stderr: true,
  timestamps: false,
});

if (!error) {
  modem.demuxStream(
    Readable.fromWeb(result as any),
    process.stdout,
    process.stderr,
  );
} else {
  console.error(error);
}
```
