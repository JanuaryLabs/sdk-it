# @sdk-it/cli

<p align="center">Command-line interface for SDK-IT that simplifies generating type-safe client SDKs from OpenAPI specifications</p>

## Installation

```bash
# Install globally
npm install -g @sdk-it/cli

# Or use with npx without installing
npx @sdk-it/cli
```

## Usage

The CLI provides a simple way to generate SDKs from OpenAPI specifications

### Basic Command Structure

```bash
npx @sdk-it/cli <language> --spec <path-to-spec> --output <output-directory> [options]
```

### Options

| Option        | Alias | Description                                              | Default    |
| ------------- | ----- | -------------------------------------------------------- | ---------- |
| `--spec`      | `-s`  | Path to OpenAPI specification file (local or remote URL) | _Required_ |
| `--output`    | `-o`  | Output directory for the generated SDK                   | _Required_ |
| `--name`      | `-n`  | Name of the generated client                             | `Client`   |
| `--mode`      | `-m`  | Generation mode: `full` or `minimal`                     | `minimal`  |
| `--formatter` |       | Formatter command to run on generated code               |            |

#### Mode Options

- `minimal`: Generates only the client SDK files (default)
- `full`: Generates a complete project including package.json and tsconfig.json (useful for monorepo/workspaces)

#### Formatter

You can specify a command to format the generated code. The special variable `$SDK_IT_OUTPUT` will be replaced with the output directory path.

Examples:

- `--formatter "prettier $SDK_IT_OUTPUT --write"`
- `--formatter "biome check $SDK_IT_OUTPUT --write"`

### Supported Specification Formats

- JSON (`.json`)
- YAML (`.yaml`, `.yml`)

## Examples

### Generate SDK from a Remote OpenAPI Specification

```bash
npx sdk-it -s https://petstore.swagger.io/v2/swagger.json -o ./client
```

### Generate SDK with Custom Client Name

```bash
npx sdk-it -s ./openapi.json -o ./client -n PetStore
```

### Generate Full Project with Formatting

```bash
npx sdk-it -s ./openapi.yaml -o ./client -m full --formatter "prettier $SDK_IT_OUTPUT --write"
```

## Complete Example

Let's generate a client SDK for the Hetzner Cloud API with automatic formatting:

```bash
# Generate SDK from Hetzner Cloud API spec with Prettier formatting
npx sdk-it -s https://raw.githubusercontent.com/MaximilianKoestler/hcloud-openapi/refs/heads/main/openapi/hcloud.json -o ./client --formatter "prettier $SDK_IT_OUTPUT --write"
```

After running this command:

1. The OpenAPI specification is downloaded from the Hetzner Cloud documentation
2. A type-safe TypeScript SDK is generated in the `./client` directory
3. Prettier is run on the generated code to ensure consistent formatting

You can then use the generated SDK in your application:

```typescript
import { Client } from './client';

// Create a client instance with your API token
const client = new Client({
  baseUrl: 'https://api.hetzner.cloud/v1',
  headers: {
    Authorization: 'Bearer your_api_token',
  },
});

// Call API methods with type safety
const servers = await client.request('GET /servers', {});

if (error) {
  console.error('Error fetching servers:', error);
} else {
  console.log('Servers:', servers);
}
```
