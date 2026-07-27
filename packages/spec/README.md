# @sdk-it/spec

Load OpenAPI or Postman documents and normalize them into the intermediate
representation shared by SDK-IT generators.

## Install

```bash
npm install @sdk-it/spec
```

## Load and process a specification

```typescript
import { loadSpec, toIR } from '@sdk-it/spec';

const spec = await loadSpec('./openapi.yaml');
const ir = await toIR({
  spec,
  responses: { flattenErrorResponses: true },
});

console.log(ir.paths);
```

`loadSpec` accepts local JSON or YAML paths and HTTP(S) URLs. It also detects
Postman collections and converts them to OpenAPI. `toIR` runs the default
ordered processing pipeline and returns the normalized `IR`.

## Add a processing plugin

```typescript
import {
  createDefaultProcessingPlugins,
  iterateOperations,
  loadSpec,
  toIR,
} from '@sdk-it/spec';

const spec = await loadSpec('./openapi.yaml');
const plugins = createDefaultProcessingPlugins();

plugins.splice(-1, 0, {
  name: 'require-operation-summaries',
  process({ spec, report }) {
    for (const { entry, operation } of iterateOperations(spec)) {
      if (!operation.summary) {
        report({
          severity: 'warning',
          code: 'missing-summary',
          message: 'Operation has no summary',
          path: `${entry.method.toUpperCase()} ${entry.path}`,
        });
      }
    }
  },
});

const ir = await toIR({ spec, plugins });
```

The example inserts the diagnostic plugin before the final canonicalization
step. Plugins run sequentially and may be asynchronous. See the
[processing-plugin architecture](../../docs/architecture/spec-processing-plugins.md)
for the default order, diagnostics, cancellation, and extension rules.
