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
import { generate } from '@sdk-it/typescript';

const spec = await fetch('https://api.openstatus.dev/v1/openapi').then(
  (response) => response.json(),
);

await generate(spec, {
  output: './src/generated/openstatus',
  mode: 'minimal',
  name: 'OpenStatus',
});
```

`name` controls the generated client class name. `minimal` mode writes client
source files directly to `output`.

## Use the generated client

```typescript
import { OpenStatus } from './src/generated/openstatus/index.ts';

const client = new OpenStatus({
  baseUrl: 'https://api.openstatus.dev/v1',
  'x-openstatus-key': process.env.OPENSTATUS_API_KEY,
});

const reports = await client.request('GET /status_report', {});
console.log(reports);
```

`request` returns unwrapped response data. It throws `ParseError` when input
validation fails and an `APIError` subclass when the server returns a
non-successful response:

```typescript
import {
  APIError,
  OpenStatus,
  ParseError,
} from './src/generated/openstatus/index.ts';

const client = new OpenStatus({
  baseUrl: 'https://api.openstatus.dev/v1',
  'x-openstatus-key': process.env.OPENSTATUS_API_KEY,
});

try {
  const report = await client.request('GET /status_report/{id}', { id: '42' });
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
