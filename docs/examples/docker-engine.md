# Build a Docker Engine SDK

## Generate the SDK

Inside an existing TypeScript project:

```bash
npm install zod fast-content-type-parse docker-modem
npm install --save-dev @types/docker-modem

npx @sdk-it/cli@latest generate typescript \
  --spec https://docs.docker.com/reference/api/engine/version/v1.48.yaml \
  --output ./src/generated/docker-engine \
  --name DockerEngine \
  --mode minimal
```

## Connect through the Docker socket

The generated client accepts a custom `fetch` implementation. This adapter
passes requests to `docker-modem`, which handles the local Docker socket:

```typescript
import Modem from 'docker-modem';
import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

import { DockerEngine } from './src/generated/docker-engine/index.ts';

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
        (error, data) => {
          if (error) {
            reject(error);
          } else if (data instanceof IncomingMessage) {
            resolve(
              new Response(Readable.toWeb(data) as ReadableStream<Uint8Array>, {
                status: data.statusCode,
                statusText: data.statusMessage,
                headers: new Headers(data.headers as any),
              }),
            );
          } else {
            reject(new Error('Unexpected Docker response'));
          }
        },
      );
    });
  },
});
```

## Get the Docker version

Docker's specification marks this response as a stream, so read the returned
body before using its JSON:

```typescript
const stream = await docker.request('GET /version', {});
const version = await new Response(stream).json();

console.log(version);
```

## Stream container logs

The Docker specification encodes query booleans as strings:

```typescript
const stream = await docker.request('GET /containers/{id}/logs', {
  id: '1daf90ceeee2',
  follow: 'true',
  stdout: 'true',
  stderr: 'true',
});

const decoder = new TextDecoder();
for await (const chunk of stream) {
  console.log(decoder.decode(chunk as Uint8Array));
}
```

## Demultiplex container logs

```typescript
const stream = await docker.request('GET /containers/{id}/logs', {
  id: '3b85714a4095',
  follow: 'true',
  stdout: 'true',
  stderr: 'true',
  timestamps: 'false',
});

modem.demuxStream(
  Readable.fromWeb(stream as any),
  process.stdout,
  process.stderr,
);
```
