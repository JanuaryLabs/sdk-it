import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

describe('a generic interface used with different type arguments', () => {
  test('the document and the client type each instantiation with its own type argument', async () => {
    await using workspace = await analysisWorkspace('generic-interface-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

interface Box<T> {
  v: T;
}

export const app = new Hono();

function load(): { a: Box<'x'>; b: Box<'y'> } {
  return { a: { v: 'x' }, b: { v: 'y' } };
}

/** @openapi getBoxes */
app.get('/boxes', validate(() => ({})), (c) => {
  return c.json(load());
});
`,
    });
    using project = openAnalysisProject(workspace.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const schemas = spec.components.schemas ?? {};
    const resolve = (schema: any): any =>
      schema.$ref
        ? resolve(schemas[schema.$ref.replace('#/components/schemas/', '')])
        : schema;
    const body = resolve(
      spec.paths['/boxes']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema,
    );
    const output = join(workspace.path, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Boxes', version: '1.0.0' },
        paths: spec.paths,
        components: spec.components,
      },
      {
        output,
        name: 'Boxes',
        packageName: '@acme/sdk',
        readme: false,
        mode: 'full',
      },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { createBoxes } from './index.ts';
const client = createBoxes({ baseUrl: 'https://example.test' });
const boxes = await client.request('GET /boxes', {});
const a: 'x' = boxes.a.v;
const b: 'y' = boxes.b.v;
// @ts-expect-error b is a Box<'y'>, so its v is never 'x'.
const wrong: 'x' = boxes.b.v;
void [a, b, wrong];
`,
    );

    const { files, diagnostics } = typecheck(configPath);

    assert.deepStrictEqual(resolve(body.properties.a).properties.v, {
      type: 'string',
      enum: ['x'],
    });
    assert.deepStrictEqual(resolve(body.properties.b).properties.v, {
      type: 'string',
      enum: ['y'],
    });
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test("Meddit's readings: creatinine, weight and height each carry their own unit", async () => {
    await using workspace = await analysisWorkspace('generic-interface-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

interface RecordedReading<Unit extends string> {
  value: number;
  unit: Unit;
  measuredAt: Date;
}

interface CalculatorInputs {
  creatinine: RecordedReading<'mg/dL' | 'umol/L'> & { ageYears: number };
  weight: RecordedReading<'kg' | '[lb_av]'> | null;
  height: RecordedReading<'cm' | '[in_i]'> | null;
}

export const app = new Hono();

declare function load(): CalculatorInputs;

/** @openapi getCalculatorInputs */
app.get('/calculator-inputs', validate(() => ({})), (c) => {
  return c.json(load());
});
`,
    });
    using project = openAnalysisProject(workspace.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const schemas = spec.components.schemas ?? {};
    const resolve = (schema: any): any =>
      schema.$ref
        ? resolve(schemas[schema.$ref.replace('#/components/schemas/', '')])
        : schema;
    const unitsOf = (schema: any): any[] => {
      const resolved = resolve(schema);
      return [
        ...(resolved.properties?.unit ? [resolved.properties.unit] : []),
        ...[
          ...(resolved.allOf ?? []),
          ...(resolved.anyOf ?? []),
          ...(resolved.oneOf ?? []),
        ].flatMap(unitsOf),
      ];
    };
    // The checker orders a union's members, so the enum is compared as a set.
    const enumOf = (unit: any): unknown[] =>
      (unit.enum ?? unit.anyOf.flatMap(enumOf)).toSorted();
    const body = resolve(
      spec.paths['/calculator-inputs']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema,
    );
    const output = join(workspace.path, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Calculators', version: '1.0.0' },
        paths: spec.paths,
        components: spec.components,
      },
      {
        output,
        name: 'Calculators',
        packageName: '@acme/sdk',
        readme: false,
        mode: 'full',
      },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { createCalculators } from './index.ts';
const client = createCalculators({ baseUrl: 'https://example.test' });
const inputs = await client.request('GET /calculator-inputs', {});
type CreatinineUnit = typeof inputs.creatinine.unit;
type WeightUnit = NonNullable<typeof inputs.weight>['unit'];
type HeightUnit = NonNullable<typeof inputs.height>['unit'];
const age: number = inputs.creatinine.ageYears;
const mgdl: CreatinineUnit = 'mg/dL';
const umol: CreatinineUnit = 'umol/L';
// @ts-expect-error a creatinine is never in kg.
const creatinineKg: CreatinineUnit = 'kg';
const kg: WeightUnit = 'kg';
const lb: WeightUnit = '[lb_av]';
// @ts-expect-error a weight is never in mg/dL.
const weightMgdl: WeightUnit = 'mg/dL';
const cm: HeightUnit = 'cm';
const inch: HeightUnit = '[in_i]';
// @ts-expect-error a height is never in kg.
const heightKg: HeightUnit = 'kg';
void [age, mgdl, umol, creatinineKg, kg, lb, weightMgdl, cm, inch, heightKg];
`,
    );

    const { files, diagnostics } = typecheck(configPath);

    assert.deepStrictEqual(unitsOf(body.properties.creatinine).map(enumOf), [
      ['mg/dL', 'umol/L'].toSorted(),
    ]);
    assert.deepStrictEqual(unitsOf(body.properties.weight).map(enumOf), [
      ['kg', '[lb_av]'].toSorted(),
    ]);
    assert.deepStrictEqual(unitsOf(body.properties.height).map(enumOf), [
      ['cm', '[in_i]'].toSorted(),
    ]);
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test('a non-generic interface used twice is one shared named component', async () => {
    await using workspace = await analysisWorkspace('generic-interface-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

interface Ticket {
  id: string;
}

export const app = new Hono();

declare function load(): { a: Ticket; b: Ticket };

/** @openapi getTickets */
app.get('/tickets', validate(() => ({})), (c) => {
  return c.json(load());
});
`,
    });
    using project = openAnalysisProject(workspace.tsconfig);

    const spec = await analyze(project, { responseAnalyzer });

    const body: any =
      spec.paths['/tickets']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;
    assert.deepStrictEqual(body.properties, {
      a: { $ref: '#/components/schemas/Ticket' },
      b: { $ref: '#/components/schemas/Ticket' },
    });
    assert.deepStrictEqual(spec.components.schemas?.Ticket, {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    });
  });

  test('two instantiations of a self-referencing generic interface are distinct, deterministic components', async () => {
    const files = {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

interface Tree<T> {
  value: T;
  children: Tree<T>[];
}

export const app = new Hono();

declare function load(): { a: Tree<'x'>; b: Tree<'y'> };

/** @openapi getTrees */
app.get('/trees', validate(() => ({})), (c) => {
  return c.json(load());
});
`,
    };
    await using workspace = await analysisWorkspace(
      'generic-interface-',
      files,
    );
    // The same routes with the fields swapped, so the second analysis meets
    // Tree<'y'> first.
    await using again = await analysisWorkspace('generic-interface-', {
      'route.ts': files['route.ts'].replace(
        "{ a: Tree<'x'>; b: Tree<'y'> }",
        "{ a: Tree<'y'>; b: Tree<'x'> }",
      ),
    });
    using project = openAnalysisProject(workspace.tsconfig);
    using projectAgain = openAnalysisProject(again.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const specAgain = await analyze(projectAgain, { responseAnalyzer });
    const schemas = spec.components.schemas ?? {};
    const body: any =
      spec.paths['/trees']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;
    const component = (ref: string): any =>
      schemas[ref.replace('#/components/schemas/', '')];
    const a = body.properties.a.$ref;
    const b = body.properties.b.$ref;
    const output = join(workspace.path, 'client');
    await generate(
      {
        openapi: '3.1.0',
        info: { title: 'Trees', version: '1.0.0' },
        paths: spec.paths,
        components: spec.components,
      },
      {
        output,
        name: 'Trees',
        packageName: '@acme/sdk',
        readme: false,
        mode: 'full',
      },
    );
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { createTrees } from './index.ts';
const client = createTrees({ baseUrl: 'https://example.test' });
const trees = await client.request('GET /trees', {});
const a: 'x' = trees.a.value;
const aChildren: 'x'[] = trees.a.children.map((child) => child.value);
const b: 'y' = trees.b.value;
const bChildren: 'y'[] = trees.b.children.map((child) => child.value);
// @ts-expect-error b is a Tree<'y'>, so its children are never Tree<'x'>.
const wrong: 'x'[] = trees.b.children.map((child) => child.value);
void [a, aChildren, b, bChildren, wrong];
`,
    );

    const { files: checked, diagnostics } = typecheck(configPath);

    assert.notStrictEqual(a, b);
    assert.deepStrictEqual(component(a).properties.value, {
      type: 'string',
      enum: ['x'],
    });
    assert.deepStrictEqual(component(a).properties.children.items, {
      $ref: a,
    });
    assert.deepStrictEqual(component(b).properties.value, {
      type: 'string',
      enum: ['y'],
    });
    assert.deepStrictEqual(component(b).properties.children.items, {
      $ref: b,
    });
    const bodyAgain: any =
      specAgain.paths['/trees']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;
    assert.deepStrictEqual(specAgain.components, spec.components);
    assert.strictEqual(bodyAgain.properties.b.$ref, a);
    assert.strictEqual(bodyAgain.properties.a.$ref, b);
    assert.ok(checked.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test('two instantiations whose names clean to the same text stay distinct components', async () => {
    await using workspace = await analysisWorkspace('generic-interface-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

interface Box<T> {
  v: T;
}

export const app = new Hono();

declare function load(): { a: Box<'a-b'>; b: Box<'a_b'> };

/** @openapi getBoxes */
app.get('/boxes', validate(() => ({})), (c) => {
  return c.json(load());
});
`,
    });
    using project = openAnalysisProject(workspace.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const schemas = spec.components.schemas ?? {};
    const body: any =
      spec.paths['/boxes']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;
    const component = (ref: string): any =>
      schemas[ref.replace('#/components/schemas/', '')];
    const a = body.properties.a.$ref;
    const b = body.properties.b.$ref;

    assert.notStrictEqual(a, b);
    assert.deepStrictEqual(component(a).properties.v, {
      type: 'string',
      enum: ['a-b'],
    });
    assert.deepStrictEqual(component(b).properties.v, {
      type: 'string',
      enum: ['a_b'],
    });
  });

  test('a generic interface that references this keeps its name when its type arguments are the defaults', async () => {
    await using workspace = await analysisWorkspace('generic-interface-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

interface Linked<T = string> {
  value: T;
  next: this | null;
}

export const app = new Hono();

declare function load(): { a: Linked; b: Linked<'x'> };

/** @openapi getLinks */
app.get('/links', validate(() => ({})), (c) => {
  return c.json(load());
});
`,
    });
    using project = openAnalysisProject(workspace.tsconfig);
    const spec = await analyze(project, { responseAnalyzer });
    const schemas = spec.components.schemas ?? {};
    const body: any =
      spec.paths['/links']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;
    const component = (ref: string): any =>
      schemas[ref.replace('#/components/schemas/', '')];
    const a = body.properties.a.$ref;
    const b = body.properties.b.$ref;

    assert.strictEqual(a, '#/components/schemas/Linked');
    assert.notStrictEqual(b, a);
    assert.deepStrictEqual(component(b).properties.value, {
      type: 'string',
      enum: ['x'],
    });
  });
});
