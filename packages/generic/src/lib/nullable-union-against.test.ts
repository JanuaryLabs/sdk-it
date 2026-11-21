import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { operationInputs, toIR } from '@sdk-it/spec';
import { analysisWorkspace } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// text2sql's inputs.stringBoolean: zod writes the coerced union as a union of
// its own, so the nullish makes a union of a union and null (#5136). A coerce
// branch accepts any value and zod types its input as unknown, so the input
// every host reads (operationInputs) is where losing the union shows.
const route = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi listProviders */
app.get('/providers', validate((payload) => ({
  enabledOnly: {
    select: payload.query.enabledOnly,
    against: z.coerce
      .string()
      .or(z.coerce.boolean())
      .nullish()
      .transform((value) => value === true || value === 'true'),
  },
})), (c) => c.body(null, 204));
`;

/** A schema's types and unions, nested as written: `anyOf(anyOf(string,boolean),null)`. */
function shape(schema: SchemaObject | ReferenceObject | undefined): string {
  if (!schema || '$ref' in schema) {
    return String(schema?.$ref);
  }
  const own = [schema.type ?? []].flat().join('|');
  const kind = schema.anyOf ? 'anyOf' : schema.oneOf ? 'oneOf' : undefined;
  return kind
    ? `${own}${kind}(${(schema[kind] ?? []).map(shape).join(',')})`
    : own;
}

void test('a nullish coerced union against keeps its union and null in the IR every host reads', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('nullable-union-against-', {
    'route.ts': route,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });

  // Act
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Providers', version: '1.0.0' },
      paths,
      components,
    },
  });

  // Assert
  const operation = ir.paths['/providers']?.get;
  assert.ok(operation, 'GET /providers');
  const [input] = operationInputs(ir, operation);
  assert.equal(
    shape(input?.schema['x-properties']?.enabledOnly),
    'anyOf(anyOf(string,boolean),null)',
  );
});

void test('a generated client sends null to a nullish coerced union against as null, as the server keeps it', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('nullable-union-client-', {
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi setProvider */
app.post('/providers', validate((payload) => ({
  enabled: {
    select: payload.body.enabled,
    against: z.coerce.string().or(z.coerce.boolean()).nullish(),
  },
})), (c) => c.body(null, 204));
`,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths, components } = await analyze(project, { responseAnalyzer });
  const output = join(workspace.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Providers', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      paths,
      components,
    },
    {
      output,
      name: 'Providers',
      packageName: '@acme/providers',
      readme: false,
      mode: 'full',
    },
  );
  const { createProviders } = await import(
    pathToFileURL(join(output, 'src/index.ts')).href
  );
  const client = createProviders({
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });

  // Act
  const prepared = await client.prepare('POST /providers', { enabled: null });

  // Assert
  assert.deepEqual(JSON.parse(String(prepared.init.body)), { enabled: null });
});
