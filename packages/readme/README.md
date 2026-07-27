# @sdk-it/readme

Render the documentation stored in SDK-IT's processed intermediate
representation as Markdown. Language generators use this package when
creating generated SDK documentation.

## Install

```bash
npm install @sdk-it/readme @sdk-it/spec
```

## Render Markdown

```typescript
import { writeFile } from 'node:fs/promises';

import { toReadme } from '@sdk-it/readme';
import { loadSpec, toIR } from '@sdk-it/spec';

const spec = await loadSpec('./openapi.yaml');
const ir = await toIR({ spec });
const markdown = toReadme(ir);

await writeFile('./README.md', markdown);
```

`toReadme` accepts an `IR`, not a raw OpenAPI object. Process the document
with `toIR` first so operation metadata and generated overview sections are
available.

The package also exports the `Generator` interface used by language-specific
documentation and snippet generators.
