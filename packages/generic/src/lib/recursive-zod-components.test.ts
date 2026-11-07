import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

function route(against: string, imports = '') {
  return `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
${imports}
export const app = new Hono();

/** @openapi saveShortcut */
app.post('/shortcuts', validate((payload) => ({
  integrations: {
    select: payload.body.integrations,
    against: ${against},
  },
})), (c) => {
  return c.json({ ok: true });
});
`;
}

/** Every `$ref` in `value`, wherever it sits. */
function refs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(refs);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      key === '$ref' && typeof child === 'string' ? [child] : refs(child),
    );
  }
  return [];
}

/** Analyzes the app in `files`; each name in `modules` is a `<name>.ts` module of schemas the routes reference as `<name>.x`. */
async function analyzeFiles(
  files: Record<string, string>,
  modules: string[] = [],
) {
  await using dir = await analysisWorkspace('recursive-zod-', files);
  using project = openAnalysisProject(dir.tsconfig);
  return await analyze(project, {
    responseAnalyzer,
    imports: modules.map((name) => ({
      import: name,
      from: join(dir.path, `${name}.ts`),
    })),
  });
}

test('a named z.json() inside a record becomes a JSON component, and the generated client accepts nested JSON and rejects a value JSON cannot carry', async () => {
  await using dir = await analysisWorkspace('recursive-zod-json-', {
    'route.ts': route(
      `z.record(z.string(), z.json().meta({ id: 'JsonValue' }))`,
    ),
  });
  using project = openAnalysisProject(dir.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  const output = join(dir.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Shortcuts', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    {
      output,
      name: 'Shortcuts',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  const consumerPath = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumerPath,
    `import { createShortcuts } from './index.ts';
const client = createShortcuts({ baseUrl: 'https://example.test' });
void client.request('POST /shortcuts', {
  integrations: { slack: { channels: ['a', 'b'], muted: null, depth: { n: 1 } } },
});
void client.request('POST /shortcuts', {
  // @ts-expect-error a function is not JSON.
  integrations: { slack: () => 1 },
});
`,
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));

  const { files, diagnostics } = typecheck(configPath);

  assert.ok(spec.components.schemas?.JsonValue);
  for (const ref of refs(spec.paths)) {
    const name = ref.replace('#/components/schemas/', '');
    assert.ok(spec.components.schemas?.[name], `${ref} resolves`);
  }
  assert.ok(files.includes(consumerPath));
  assert.deepStrictEqual(diagnostics, []);
});

test('a recursive schema without a name fails analysis and says how to name it', async () => {
  await assert.rejects(
    analyzeFiles({ 'route.ts': route('z.record(z.string(), z.json())') }),
    /POST \/shortcuts[\s\S]*integrations[\s\S]*\.meta\(\{ id \}\)/,
  );
});

test('a recursive schema without a name selected as the whole body fails analysis, naming the body', async () => {
  await assert.rejects(
    analyzeFiles({
      'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi saveShortcut */
app.post('/shortcuts', validate((payload) => ({
  body: { select: payload.body, against: z.record(z.string(), z.json()) },
})), (c) => c.json({ ok: true }));
`,
    }),
    /POST \/shortcuts body: A recursive schema has no name; give it \.meta\(\{ id \}\)/,
  );
});

test('a named recursive object becomes a component whose recursive field points at it', async () => {
  const spec = await analyzeFiles(
    {
      'inputs.ts': `import { z } from 'zod';
export const leaf = z.object({
  label: z.string(),
  get next() {
    return leaf.optional();
  },
}).meta({ id: 'Leaf' });
`,
      'route.ts': route('inputs.leaf', `import * as inputs from './inputs';`),
    },
    ['inputs'],
  );

  const leaf = spec.components.schemas?.Leaf;
  assert.ok(leaf && !('$ref' in leaf));
  assert.deepStrictEqual(leaf.properties?.label, { type: 'string' });
  assert.deepStrictEqual(leaf.properties?.next, {
    $ref: '#/components/schemas/Leaf',
  });
  assert.deepStrictEqual(leaf.required, ['label']);
  assert.deepStrictEqual(refs(spec.paths['/shortcuts']?.post?.requestBody), [
    '#/components/schemas/Leaf',
  ]);
});

test('one id given to different schemas in two routes fails analysis, naming the id', async () => {
  await assert.rejects(
    analyzeFiles({
      'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi saveShortcut */
app.post('/shortcuts', validate((payload) => ({
  name: { select: payload.body.name, against: z.string().meta({ id: 'Name' }) },
})), (c) => c.json({ ok: true }));

/** @openapi saveSpace */
app.post('/spaces', validate((payload) => ({
  name: { select: payload.body.name, against: z.number().meta({ id: 'Name' }) },
})), (c) => c.json({ ok: true }));
`,
    }),
    /POST \/spaces body field name: two different schemas share the id "Name"/,
  );
});

test('one id given to the same schema in two routes is one component both point at', async () => {
  const shared = `z.record(z.string(), z.json().meta({ id: 'JsonValue' }))`;
  const spec = await analyzeFiles({
    'route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi createShortcut */
app.post('/shortcuts', validate((payload) => ({
  integrations: { select: payload.body.integrations, against: ${shared} },
})), (c) => c.json({ ok: true }));

/** @openapi updateShortcut */
app.patch('/shortcuts', validate((payload) => ({
  integrations: { select: payload.body.integrations, against: ${shared} },
})), (c) => c.json({ ok: true }));
`,
  });

  assert.ok(spec.components.schemas?.JsonValue);
  for (const method of ['post', 'patch'] as const) {
    assert.deepStrictEqual(
      refs(spec.paths['/shortcuts']?.[method]?.requestBody),
      ['#/components/schemas/JsonValue'],
    );
  }
});

test('a $ref that points at no component fails generation with a message naming it', async () => {
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Dangling', version: '1.0.0' },
    paths: {
      '/shortcuts': {
        post: {
          operationId: 'saveShortcut',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    integrations: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Missing' },
                    },
                  },
                },
              },
            },
          },
          responses: { '204': { description: 'Saved' } },
        },
      },
    },
  };
  await using dir = await new TemporaryFiles().directory(
    'recursive-zod-dangling-',
  );

  await assert.rejects(
    generate(spec, {
      output: join(dir.path, 'client'),
      name: 'Dangling',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    }),
    /#\/components\/schemas\/Missing/,
  );
});
