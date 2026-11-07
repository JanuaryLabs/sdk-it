import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import {
  type AnalysisWorkspace,
  analysisWorkspace,
  typecheck,
} from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const routes = `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { parse, validate } from '@sdk-it/hono/runtime';

class Widget {}

class Gauge {
  id = 'g1';
  handler = () => 1;
  read() {
    return 1;
  }
}

interface Gadget {
  id: string;
  run(): void;
  onTick?: () => void;
}

export const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ message: error.message, cause: error.cause }, error.status);
  throw error;
});

/** @openapi saveName */
app.post('/names', validate(() => ({})), async (c) => {
  await parse(z.object({ name: z.string() }), await c.req.json());
  return c.json({ ok: true });
});

/** @openapi getWidget */
app.get('/widget', validate(() => ({})), (c) => {
  return c.json({
    id: 'w1',
    greet() {
      return 'hi';
    },
    onChange: (value: string) => value,
    factory: Widget,
  });
});

/** @openapi getGauge */
app.get('/gauge', validate(() => ({})), (c) => {
  return c.json(new Gauge());
});

/** @openapi getGadget */
app.get('/gadget', validate(() => ({})), (c) => {
  const gadget: Gadget = { id: 'd1', run() {} };
  return c.json(gadget);
});

/** @openapi getShorthand */
app.get('/shorthand', validate(() => ({})), (c) => {
  const greet = () => 'hi';
  return c.json({ id: 's1', greet });
});

/** @openapi getTyped */
app.get('/typed', validate(() => ({})), (c) => {
  const typed: { id: string; run: () => void; stop?: () => void } = {
    id: 't1',
    run() {},
  };
  return c.json(typed);
});
`;

/** Analyzes the app in `workspace`, collecting what the analyzer warns about. */
async function analyzeRoutes(t: TestContext, workspace: AnalysisWorkspace) {
  const warn = t.mock.method(console, 'warn', () => undefined);
  try {
    using project = openAnalysisProject(workspace.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    return {
      spec,
      warnings: warn.mock.calls.map((call) => String(call.arguments[0])),
    };
  } finally {
    warn.mock.restore();
  }
}

test('a validation error derives its field errors as a record of issues, so the generated client types them instead of any', async (t) => {
  await using workspace = await analysisWorkspace('derived-mapped-', {
    'route.ts': routes,
  });
  const { spec } = await analyzeRoutes(t, workspace);
  const output = join(workspace.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Names', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    {
      output,
      name: 'Names',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  const consumer = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumer,
    `import { type NamesEndpoints } from './index.ts';

type Rejected = Extract<NamesEndpoints['POST /names']['error'], { status: 400 }>;
export function issues(error: Rejected) {
  if ('errors' in error.data.cause) {
    const name: { message: string; code: string; path: string }[] | undefined =
      error.data.cause.errors['name'];
    // @ts-expect-error field errors are a record, not a number.
    const invalid: number = error.data.cause.errors;
    return [name, invalid];
  }
  return [];
}
`,
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));

  const { files, diagnostics } = typecheck(configPath);

  assert.doesNotMatch(JSON.stringify(spec), /"type":"any"/);
  assert.ok(files.includes(consumer));
  assert.deepStrictEqual(diagnostics, []);
});

test("a route that only uses validate() gives the generated client validate()'s 400 bodies, so a consumer narrows to the validation failure by its code and reads its field errors", async (t) => {
  await using workspace = await analysisWorkspace('derived-validate-only-', {
    'route.ts': `import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ message: error.message, cause: error.cause }, error.status);
  throw error;
});
/** @openapi createItem */
app.post('/items', validate('application/json', (payload) => ({
  name: { select: payload.body.name, against: z.string() },
})), (c) => c.json({ ok: true }));
`,
  });
  const { spec } = await analyzeRoutes(t, workspace);
  const output = join(workspace.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Items', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    {
      output,
      name: 'Items',
      packageName: '@acme/sdk',
      readme: false,
      mode: 'full',
    },
  );
  const consumer = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumer,
    `import { type ItemsEndpoints } from './index.ts';

type Rejected = Extract<ItemsEndpoints['POST /items']['error'], { status: 400 }>;
export function issues(error: Rejected) {
  const { cause } = error.data;
  if (cause.code === 'api/validation-failed') {
    const name: { message: string; code: string; path: string }[] | undefined =
      cause.errors['name'];
    return name;
  }
  if (cause.code === 'api/invalid-json') {
    // @ts-expect-error a body that is not JSON has no field errors.
    return cause.errors;
  }
  return undefined;
}
`,
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));

  const { files, diagnostics } = typecheck(configPath);

  assert.ok(files.includes(consumer));
  assert.deepStrictEqual(diagnostics, []);
});

const dataOnly = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

void test.each(
  [
    {
      route: '/widget',
      shape: 'an object literal with a method, an arrow and a class',
      expected: dataOnly({ id: { type: 'string', enum: ['w1'] } }),
    },
    {
      route: '/shorthand',
      shape: 'an object literal with a shorthand function',
      expected: dataOnly({ id: { type: 'string', enum: ['s1'] } }),
    },
    {
      route: '/typed',
      shape:
        'a value typed by an object type with required and optional functions',
      expected: dataOnly({ id: { type: 'string' } }),
    },
    {
      route: '/gauge',
      shape: 'a class instance with a function field and a method',
      component: 'Gauge',
      expected: dataOnly({ id: { type: 'string' } }),
    },
    {
      route: '/gadget',
      shape: 'an interface with a method and an optional callback',
      component: 'Gadget',
      expected: dataOnly({ id: { type: 'string' } }),
    },
  ],
  ({ route, shape, component, expected }) =>
    test(`a response that is ${shape} derives only its data`, async (t) => {
      await using workspace = await analysisWorkspace('derived-callables-', {
        'route.ts': routes,
      });
      const { spec } = await analyzeRoutes(t, workspace);

      const schema =
        spec.paths[route]?.get?.responses?.['200']?.content?.[
          'application/json'
        ]?.schema;

      if (component) {
        assert.deepStrictEqual(schema, {
          $ref: `#/components/schemas/${component}`,
        });
        assert.deepStrictEqual(spec.components.schemas?.[component], expected);
      } else {
        assert.deepStrictEqual(schema, expected);
      }
    }),
);

test('analysis derives mapped, method, function and constructor types from the checker without warning about unhandled syntax', async (t) => {
  await using workspace = await analysisWorkspace('derived-warnings-', {
    'route.ts': routes,
  });
  const { warnings } = await analyzeRoutes(t, workspace);

  assert.deepStrictEqual(
    warnings.filter((warning) => /Unhandled (node|type)/.test(warning)),
    [],
  );
});
