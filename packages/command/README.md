# @sdk-it/command

Build a Commander.js CLI directly from an OpenAPI document. Each operation
becomes a subcommand with validated flags, JSON-file input, stdin input, and
machine-readable output.

## Install

```bash
npm install @sdk-it/command
```

## Create a CLI

```javascript
#!/usr/bin/env node
import { command } from '@sdk-it/command';

const program = await command('./openapi.yaml', {
  name: 'acme',
  description: 'Acme API CLI',
  version: '1.0.0',
});

await program.parseAsync();
```

The base URL is resolved from `options.baseUrl`, `ACME_BASE_URL`, or the first
OpenAPI `servers` entry. Bearer tokens come from `options.token`,
`ACME_TOKEN`, or the global `--token` option. Use `baseUrlEnv` and `tokenEnv`
to override the environment-variable names.

## Use the generated commands

Normalized operation names become command names, and operation inputs become
flags:

```bash
acme listUsers --limit 20
acme createUser --name Alice --age 30
```

For nested input that cannot be represented as flags, pass JSON by file or
stdin:

```bash
acme createUser --input-file user.json
printf '{"name":"Alice"}' | acme createUser
```

Inspect the available operation schemas without sending a request:

```bash
acme schema
acme createUser --describe
```

Global options include `--base-url`, `--token`, and `--output json|raw`.
