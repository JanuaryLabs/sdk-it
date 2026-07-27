# SDK-IT

SDK-IT generates type-safe client SDKs from OpenAPI specifications and creates OpenAPI specs from TypeScript code.

## Features

- Type-safe TypeScript, Dart, and Python SDK generation from OpenAPI specs
- OpenAPI generation from TypeScript code, including Hono integration
- A command builder and runtime RPC client generated from OpenAPI operations
- CLI and Vite workflows for generating clients from specs or TypeScript backends
- API reference and README generation

## Get Started

Choose the workflow that matches your API source:

| Starting point                                    | Guide                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| OpenAPI JSON, YAML, or a remote specification URL | [Generate your first client](#generate-your-first-client)                                    |
| A Hono TypeScript backend                         | [Generate from a backend](./docs/recipes/backend-to-client.md)                               |
| A build script or custom generation workflow      | [Use SDK-IT programmatically](./docs/recipes/workspace-sdk.md)                               |
| A client consumed from another repository         | [Publish a generated client](./docs/recipes/workspace-sdk.md#publish-for-another-repository) |

### Generate your first client

Inside an existing TypeScript project, install the generated client's runtime
dependencies:

```bash
npm install zod fast-content-type-parse
```

Generate an SDK from an OpenAPI specification:

```bash
npx @sdk-it/cli@latest generate typescript \
  --spec https://api.openstatus.dev/v1/openapi \
  --output ./src/openstatus \
  --name OpenStatus \
  --mode minimal
```

Use the generated SDK:

```typescript
import { OpenStatus } from './src/openstatus/index.ts';

const client = new OpenStatus({
  baseUrl: 'https://api.openstatus.dev/v1/',
  'x-openstatus-key': process.env.OPENSTATUS_API_KEY!,
});

const reports = await client.request('GET /status_report', {});
console.log(reports);
```

![demo](./demo.png)

### Generate OpenAPI from TypeScript

SDK-IT statically examines your codebase and generates OpenAPI specifications from it.

- Extracts TypeScript types for request/response schemas
- Uses framework-specific adapters to detect API patterns
- Minimal configuration needed; relies on your code structure and naming conventions

```typescript
import { validate } from '@sdk-it/hono/runtime';

const app = new Hono();

/**
 * @openapi listBooks
 * @tags books
 */
app.get(
  '/books',
  validate((payload) => ({
    author: {
      select: payload.query.author,
      against: z.string(),
    },
  })),
  async (c) => {
    const books = [{ name: 'OpenAPI' }];
    return c.json(books);
  },
);
```

The analyzer infers this route because it uses the validate middleware and has an `@openapi` tag.

[Supported frameworks](#OpenAPI-Generation-Framework-Support)

## Tutorials

- [Generate your first client from OpenAPI](#generate-your-first-client)
- [Generate a client from a TypeScript backend](./docs/recipes/backend-to-client.md)
- [Generate a workspace SDK programmatically](./docs/recipes/workspace-sdk.md)
- [Upload files with Hono and React Query](./docs/recipes/file-upload.md)

## Guides

- [Cookie authentication in browsers and server-side frameworks](./docs/recipes/cookies.md)
- [React Query integration](./docs/react-query.md)
- [Angular integration](./docs/angular.md)
- [Monorepo development](./CONTRIBUTING.md#project-structure)

## Examples

- [Docker Engine](./docs/examples/docker-engine.md)
- [OpenAI](./docs/examples/openai.md)
- [Figma](./docs/examples/figma.md)
- [Hetzner Cloud](./docs/examples/hetzner.md)
- [Discord](./docs/examples/discord.md)
- [OpenStatus](./docs/examples/openstatus.md)

## Roadmap

SDK-IT supports and plans to add:

### SDK Generation Languages

- [x] TypeScript/JavaScript
- [x] Dart
- [x] Python
- [ ] Go
- [ ] Rust
- ...

### Frontend Framework Integration

- [x] [React Query](./docs/react-query.md)
- [x] [Angular](./docs/angular.md)

### OpenAPI Generation Framework Support

- [x] [Generic HTTP primitives](./packages/generic/README.md)
- [x] [Hono](./packages/hono/README.md)
- [ ] Express (WIP)
- [ ] Fastify
- [ ] Koa.js
- [ ] Next.js

Contributions welcome.

## Contributing

SDK-IT is organized as a monorepo with multiple packages:

```
.
├── packages/
│   ├── apiref/           # API reference web application (private)
│   ├── core/             # Core functionality and utilities
│   ├── cli/              # Command-line interface
│   ├── command/          # OpenAPI operation command builder
│   ├── dart/             # Dart SDK generator
│   ├── generic/          # Generic OpenAPI generation
│   ├── hono/             # Hono OpenAPI generation
│   ├── python/           # Python SDK generator
│   ├── readme/           # README generation
│   ├── rpc/              # Runtime RPC client and agent tools
│   ├── shadcn/           # Shared UI component library (private)
│   ├── spec/             # OpenAPI normalization and IR
│   ├── typescript/       # TypeScript SDK generator
│   └── vite/             # Vite generation plugin
```

Each package serves a specific purpose:

- **apiref**: Private API reference web application
- **core**: Shared utilities used by all packages
- **cli**: Command-line interface for SDK-IT
- **typescript**: Focuses on generating TypeScript code from OpenAPI specifications (primary use case)
- **generic**: OpenAPI generation using `output` and `validate` constructs.
- **hono**: OpenAPI generation for the Hono framework
- **dart** and **python**: Language-specific SDK generators
- **spec**: Shared OpenAPI loading, normalization, and intermediate representation
- **command** and **rpc**: Operation command construction and runtime dispatch
- **readme**: Generated SDK documentation
- **shadcn**: Private shared UI component library for API reference surfaces
- **vite**: Development/build integration backed by the CLI generation engine

For more detailed information about the codebase structure and development process, see the [contributing guide](CONTRIBUTING.md).
