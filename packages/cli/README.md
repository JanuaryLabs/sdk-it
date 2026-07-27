# @sdk-it/cli

Generate type-safe client SDKs from OpenAPI specifications.

## Run the CLI

Use the latest CLI without installing it globally:

```bash
npx @sdk-it/cli@latest --help
```

To pin the CLI in a project:

```bash
npm install --save-dev @sdk-it/cli
```

## Generate a TypeScript SDK

Inside an existing TypeScript project, install the generated client's runtime
dependencies:

```bash
npm install zod fast-content-type-parse
```

Generate the client:

```bash
npx @sdk-it/cli@latest generate typescript \
  --spec ./openapi.json \
  --output ./src/generated/api \
  --name MyApi \
  --mode minimal
```

Use it:

```typescript
import { MyApi } from './src/generated/api/index.ts';

const client = new MyApi({
  baseUrl: 'https://api.example.com',
});

const users = await client.request('GET /users', {});
console.log(users);
```

`request` returns the unwrapped response data. Invalid inputs and non-successful
HTTP responses throw typed errors exported by the generated SDK.

## TypeScript options

```text
npx @sdk-it/cli@latest generate typescript [options]
```

| Option                     | Description                                                  | Default   |
| -------------------------- | ------------------------------------------------------------ | --------- |
| `--spec`, `-s`             | Local path or remote URL to an OpenAPI JSON or YAML document | Required  |
| `--output`, `-o`           | Output directory                                             | Required  |
| `--name`, `-n`             | Generated client class name                                  | `Client`  |
| `--mode`, `-m`             | `minimal` source files or a `full` standalone project        | `minimal` |
| `--useTsExtension [value]` | Include `.ts` in generated imports                           | `true`    |
| `--formatter <command>`    | Command used to format the generated source directory        |           |
| `--no-default-formatter`   | Skip the default Prettier formatter                          |           |
| `--readme false`           | Skip the generated API README                                |           |
| `--pagination <config>`    | Configure pagination, such as `false` or `guess=false`       | `true`    |
| `--no-install`             | Skip dependency installation in `full` mode                  |           |
| `--verbose`, `-v`          | Show generator and installation output                       | `false`   |

`minimal` mode writes client source files directly to `--output`. `full` mode
writes source files under `<output>/src`, adds `package.json` and `tsconfig.json`,
and installs its runtime dependencies unless `--no-install` is passed.

For a custom formatter, include the generated path explicitly:

```bash
npx @sdk-it/cli@latest generate typescript \
  --spec ./openapi.json \
  --output ./src/generated/api \
  --formatter "prettier ./src/generated/api --write"
```

## Remote specification example

```bash
npx @sdk-it/cli@latest generate typescript \
  --spec https://raw.githubusercontent.com/MaximilianKoestler/hcloud-openapi/refs/heads/main/openapi/hcloud.json \
  --output ./src/generated/hetzner \
  --name Hetzner \
  --mode minimal
```

```typescript
import { Hetzner } from './src/generated/hetzner/index.ts';

const hetzner = new Hetzner({
  token: process.env.HETZNER_API_TOKEN,
});

const result = await hetzner.request('GET /servers', {});
console.log(result.servers);
```

## Other generators

The same `generate` command also exposes the Dart, Python, API reference, and
README generators:

```bash
npx @sdk-it/cli@latest generate --help
```
