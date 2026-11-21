import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import {
  type AnalysisWorkspace,
  analysisWorkspace,
  typecheck,
} from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

/** The 200 JSON body of `GET path`, with each $ref resolved. */
async function analyzeBody(workspace: AnalysisWorkspace, path: string) {
  using project = openAnalysisProject(workspace.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  const schemas = spec.components.schemas ?? {};
  const resolve = (schema: any): any =>
    schema?.$ref
      ? resolve(schemas[schema.$ref.replace('#/components/schemas/', '')])
      : schema;
  const body = resolve(
    spec.paths[path]?.get?.responses?.['200']?.content?.['application/json']
      ?.schema,
  );
  return { spec, body, resolve };
}

/** Generates the strict client of `spec` and type-checks `consumer` against it. */
async function typecheckClient(
  workspace: AnalysisWorkspace,
  spec: Awaited<ReturnType<typeof analyze>>,
  consumer: string,
) {
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
${consumer}`,
  );
  const { files, diagnostics } = typecheck(configPath);
  return { consumerPath, files, diagnostics };
}

// The checker orders a union's members, so an enum is compared as a set.
const enumOf = (schema: any): unknown[] =>
  (schema.enum ?? schema.anyOf?.flatMap(enumOf) ?? []).toSorted();

describe('a class result serialised through its toJSON', () => {
  test("a generic class's toJSON gives each field its type argument, the default one included", async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

type DosingWeightBasis = 'actual' | 'ideal' | 'adjusted';

class CreatinineClearance<Basis extends string = DosingWeightBasis> {
  readonly value: number;
  readonly unit = 'mL/min';
  readonly dosingWeight: Basis;
  constructor(value: number, dosingWeight: Basis) {
    this.value = value;
    this.dosingWeight = dosingWeight;
  }
  toJSON() {
    return { value: this.value, unit: this.unit, dosingWeight: this.dosingWeight };
  }
}

declare function anyBasis(): CreatinineClearance;
declare function actual(): CreatinineClearance<'actual'>;

export const app = new Hono();

/** @openapi getClearances */
app.get('/clearances', validate(() => ({})), (c) => {
  return c.json({ any: anyBasis().toJSON(), actual: actual().toJSON() });
});
`,
    });
    const { spec, body, resolve } = await analyzeBody(workspace, '/clearances');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const clearances = await client.request('GET /clearances', {});
const basis: 'actual' | 'ideal' | 'adjusted' = clearances.any.dosingWeight;
const actual: 'actual' = clearances.actual.dosingWeight;
// @ts-expect-error a dosing weight is a basis, never a number.
const wrong: number = clearances.any.dosingWeight;
// @ts-expect-error the actual clearance is never on the ideal weight.
const ideal: 'ideal' = clearances.actual.dosingWeight;
void [basis, actual, wrong, ideal];
`,
    );

    assert.deepStrictEqual(
      enumOf(resolve(body.properties.any).properties.dosingWeight),
      ['actual', 'adjusted', 'ideal'],
    );
    assert.deepStrictEqual(
      enumOf(resolve(body.properties.actual).properties.dosingWeight),
      ['actual'],
    );
    assert.deepStrictEqual(resolve(body.properties.any).properties.unit, {
      type: 'string',
      enum: ['mL/min'],
    });
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test("a points score's toJSON gives its points object", async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class Score<Points extends { readonly [K in keyof Points]: number }> {
  readonly points: Points;
  readonly unit = '{score}';
  constructor(points: Points) {
    this.points = points;
  }
  get value(): number {
    let sum = 0;
    for (const points of Object.values<number>(this.points)) sum += points;
    return sum;
  }
  toJSON() {
    return { value: this.value, unit: this.unit, points: this.points };
  }
}

declare function cha2ds2Vasc(): Score<{ age: 0 | 1 | 2; female: 0 | 1 }>;

export const app = new Hono();

/** @openapi getScore */
app.get('/score', validate(() => ({})), (c) => {
  return c.json(cha2ds2Vasc().toJSON());
});
`,
    });
    const { spec, body, resolve } = await analyzeBody(workspace, '/score');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const score = await client.request('GET /score', {});
const age: 0 | 1 | 2 = score.points.age;
const female: 0 | 1 = score.points.female;
const value: number = score.value;
// @ts-expect-error the score has no points for a criterion it does not name.
void score.points.diabetes;
// @ts-expect-error a criterion's points are a number, never a string.
const wrong: string = score.points.age;
void [age, female, value, wrong];
`,
    );

    const points = resolve(body.properties.points);
    assert.deepStrictEqual(Object.keys(points.properties ?? {}).toSorted(), [
      'age',
      'female',
    ]);
    assert.deepStrictEqual(enumOf(points.properties.age), [0, 1, 2]);
    assert.deepStrictEqual(enumOf(points.properties.female), [0, 1]);
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test("a method called on a union of classes gives every member's result", async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class Recommendation<Class extends string, Level extends string> {
  readonly kind = 'recommendation';
  readonly class: Class;
  readonly level: Level;
  readonly section: string;
  readonly statement: string;
  constructor(recommendationClass: Class, level: Level, section: string, statement: string) {
    this.class = recommendationClass;
    this.level = level;
    this.section = section;
    this.statement = statement;
  }
  toJSON() {
    return {
      kind: this.kind,
      guideline: 'acc-aha-accp-hrs-2023',
      class: this.class,
      level: this.level,
      section: this.section,
      statement: this.statement,
    };
  }
}

class NoRecommendation {
  readonly kind = 'no-recommendation';
  toJSON() {
    return { kind: this.kind, guideline: 'acc-aha-accp-hrs-2023' };
  }
}

type Reading<Class extends string, Level extends string> =
  Recommendation<Class, Level> | NoRecommendation;

declare function read(): Reading<'1' | '2a', 'A'>;

export const app = new Hono();

/** @openapi getReading */
app.get('/reading', validate(() => ({})), (c) => {
  return c.json(read().toJSON());
});
`,
    });
    const { spec, body, resolve } = await analyzeBody(workspace, '/reading');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const reading = await client.request('GET /reading', {});
if (reading.kind === 'recommendation') {
  const recommendationClass: '1' | '2a' = reading.class;
  const level: 'A' = reading.level;
  const section: string = reading.section;
  const statement: string = reading.statement;
  void [recommendationClass, level, section, statement];
} else {
  const kind: 'no-recommendation' = reading.kind;
  // @ts-expect-error no recommendation has no class.
  void reading.class;
  void kind;
}
`,
    );

    const members = (body.anyOf ?? [body]).map(resolve);
    const recommendation = members.find(
      (member: any) => member.properties.kind.enum[0] === 'recommendation',
    );
    assert.deepStrictEqual(
      members.map((member: any) => member.properties.kind.enum).toSorted(),
      [['no-recommendation'], ['recommendation']],
    );
    assert.deepStrictEqual(recommendation.required.toSorted(), [
      'class',
      'guideline',
      'kind',
      'level',
      'section',
      'statement',
    ]);
    assert.deepStrictEqual(enumOf(recommendation.properties.class), [
      '1',
      '2a',
    ]);
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test('a union of two result classes keeps the field only one member has', async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class CkdEpiEgfr {
  readonly value: number;
  readonly unit = 'mL/min/{1.73_m2}';
  readonly loinc = '98979-8';
  constructor(value: number) {
    this.value = value;
  }
  toJSON() {
    return { value: this.value, unit: this.unit, loinc: this.loinc };
  }
}

class CkidU25Egfr {
  readonly value: number;
  readonly unit = 'mL/min/{1.73_m2}';
  constructor(value: number) {
    this.value = value;
  }
  toJSON() {
    return { value: this.value, unit: this.unit };
  }
}

declare function egfr(): CkdEpiEgfr | CkidU25Egfr;

export const app = new Hono();

/** @openapi getEgfr */
app.get('/egfr', validate(() => ({})), (c) => {
  return c.json(egfr().toJSON());
});
`,
    });
    const { spec, body, resolve } = await analyzeBody(workspace, '/egfr');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const egfr = await client.request('GET /egfr', {});
const value: number = egfr.value;
if ('loinc' in egfr) {
  const loinc: '98979-8' = egfr.loinc;
  void loinc;
}
// @ts-expect-error only CKD-EPI has a LOINC code.
void egfr.loinc;
void value;
`,
    );

    const members = (body.anyOf ?? [body]).map(resolve);
    assert.deepStrictEqual(
      members
        .map((member: any) => Object.keys(member.properties).toSorted())
        .toSorted(),
      [
        ['loinc', 'unit', 'value'],
        ['unit', 'value'],
      ],
    );
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });
});

describe('a generic class field typed by its type parameter', () => {
  test('a field of a mapped alias of the parameter and the keys of the parameter give the instantiated types', async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class Score<Points extends Record<string, number>> {
  readonly points: Readonly<Points>;
  constructor(points: Points) {
    this.points = points;
  }
  toJSON() {
    return {
      points: this.points,
      criteria: Object.keys(this.points) as (keyof Points & string)[],
    };
  }
}

declare function cha2ds2Vasc(): Score<{ age: 0 | 1 | 2; female: 0 | 1 }>;

export const app = new Hono();

/** @openapi getScore */
app.get('/score', validate(() => ({})), (c) => {
  return c.json(cha2ds2Vasc().toJSON());
});
`,
    });
    const { spec, body, resolve } = await analyzeBody(workspace, '/score');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const score = await client.request('GET /score', {});
const age: 0 | 1 | 2 = score.points.age;
const criterion: 'age' | 'female' = score.criteria[0]!;
// @ts-expect-error diabetes is not a criterion of this score.
const diabetes: 'diabetes' = score.criteria[0]!;
void [age, criterion, diabetes];
`,
    );

    const points = resolve(body.properties.points);
    assert.deepStrictEqual(enumOf(points.properties?.age ?? {}), [0, 1, 2]);
    assert.deepStrictEqual(
      enumOf(resolve(body.properties.criteria).items ?? {}),
      ['age', 'female'],
    );
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test('a shorthand property keeps its declared array type and gives a generic value its instantiated type', async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class CreatinineClearance<Basis extends string> {
  readonly dosingWeight: Basis;
  constructor(dosingWeight: Basis) {
    this.dosingWeight = dosingWeight;
  }
  toJSON() {
    const notes = [] satisfies string[];
    const dosingWeight = this.dosingWeight;
    return { notes, dosingWeight };
  }
}

declare function ideal(): CreatinineClearance<'ideal'>;

export const app = new Hono();

/** @openapi getClearance */
app.get('/clearance', validate(() => ({})), (c) => {
  return c.json(ideal().toJSON());
});
`,
    });
    const { spec, body } = await analyzeBody(workspace, '/clearance');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const clearance = await client.request('GET /clearance', {});
const notes: string[] = clearance.notes;
const basis: 'ideal' = clearance.dosingWeight;
// @ts-expect-error the ideal clearance is never on the actual weight.
const actual: 'actual' = clearance.dosingWeight;
void [notes, basis, actual];
`,
    );

    assert.deepStrictEqual(body.properties.notes, {
      type: 'array',
      items: { type: 'string' },
    });
    assert.deepStrictEqual(body.properties.dosingWeight, {
      type: 'string',
      enum: ['ideal'],
    });
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });
});

describe('a method called on a union receiver whose result depends on the call', () => {
  test('an overloaded method gives the overload the call picks', async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class Adult {
  get(key: 'age'): number;
  get(key: 'name'): string;
  get(key: string): unknown {
    return key === 'age' ? 40 : 'adult';
  }
}

class Child {
  get(key: 'age'): number;
  get(key: 'name'): string;
  get(key: string): unknown {
    return key === 'age' ? 9 : 'child';
  }
}

declare function person(): Adult | Child;

export const app = new Hono();

/** @openapi getName */
app.get('/name', validate(() => ({})), (c) => {
  return c.json(person().get('name'));
});
`,
    });
    const { body } = await analyzeBody(workspace, '/name');

    assert.deepStrictEqual(body, { type: 'string' });
  });

  test('a generic method gives the type its arguments infer', async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class Adult {
  first<Item>(items: readonly Item[]): Item {
    return items[0]!;
  }
}

class Child {
  first<Item>(items: readonly Item[]): Item {
    return items[0]!;
  }
}

declare function person(): Adult | Child;

export const app = new Hono();

/** @openapi getFirst */
app.get('/first', validate(() => ({})), (c) => {
  return c.json(person().first([1, 2]));
});
`,
    });
    const { body } = await analyzeBody(workspace, '/first');

    assert.deepStrictEqual(body, { type: 'number' });
  });

  test('an optional call on a receiver that may be undefined gives each class member its own result', async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

class CkdEpiEgfr {
  readonly value = 90;
  readonly loinc = '98979-8';
  toJSON() {
    return { value: this.value, loinc: this.loinc };
  }
}

class CkidU25Egfr {
  readonly value = 90;
  toJSON() {
    return { value: this.value };
  }
}

declare function egfr(): CkdEpiEgfr | CkidU25Egfr | undefined;

export const app = new Hono();

/** @openapi getEgfr */
app.get('/egfr', validate(() => ({})), (c) => {
  return c.json(egfr()?.toJSON());
});
`,
    });
    const { body, resolve } = await analyzeBody(workspace, '/egfr');

    const members = (body.anyOf ?? [body]).map(resolve);
    assert.deepStrictEqual(
      members
        .map((member: any) => Object.keys(member.properties ?? {}).toSorted())
        .toSorted(),
      [['loinc', 'value'], ['value']],
    );
  });
});

describe('a generic response type', () => {
  test("a type parameter of a generic answer is its argument, whether the answer's type is declared or inferred", async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

type NonEmpty<T> = readonly [T, ...T[]];

type Attempt<Input, Result> =
  | { readonly status: 'calculated'; readonly result: Result }
  | { readonly status: 'missing'; readonly inputs: NonEmpty<keyof Input & string> };

type Answer<Input, Json> =
  | { status: 'calculated'; result: Json }
  | { status: 'missing'; inputs: NonEmpty<keyof Input & string> };

class CreatinineClearance<Basis extends string> {
  readonly value: number;
  readonly dosingWeight: Basis;
  constructor(value: number, dosingWeight: Basis) {
    this.value = value;
    this.dosingWeight = dosingWeight;
  }
  toJSON() {
    return { value: this.value, dosingWeight: this.dosingWeight };
  }
}

function declared<Input, Json>(
  attempt: Attempt<Input, { toJSON(): Json }>,
): Answer<Input, Json> {
  return attempt.status === 'calculated'
    ? { status: attempt.status, result: attempt.result.toJSON() }
    : { status: attempt.status, inputs: attempt.inputs };
}

function inferred<Input, Json>(attempt: Attempt<Input, { toJSON(): Json }>) {
  if (attempt.status === 'calculated') {
    return { status: attempt.status, result: attempt.result.toJSON() };
  }
  return { status: attempt.status, inputs: attempt.inputs };
}

interface KidneyInput {
  creatinine: number;
  weight: number;
}

declare function attempt(): Attempt<KidneyInput, CreatinineClearance<'ideal'>>;

export const app = new Hono();

/** @openapi getAnswers */
app.get('/answers', validate(() => ({})), (c) => {
  return c.json({ declared: declared(attempt()), inferred: inferred(attempt()) });
});
`,
    });
    const { spec, body, resolve } = await analyzeBody(workspace, '/answers');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const answers = await client.request('GET /answers', {});
for (const answer of [answers.declared, answers.inferred]) {
  if (answer.status === 'calculated') {
    const basis: 'ideal' = answer.result.dosingWeight;
    const value: number = answer.result.value;
    // @ts-expect-error a result is a clearance, never a string.
    const wrong: string = answer.result;
    void [basis, value, wrong];
  }
}
`,
    );

    for (const answer of [body.properties.declared, body.properties.inferred]) {
      const calculated = resolve(answer)
        .anyOf.map(resolve)
        .find(
          (member: any) => member.properties.status.enum[0] === 'calculated',
        );
      const result = resolve(calculated.properties.result);
      assert.deepStrictEqual(result.properties.dosingWeight, {
        type: 'string',
        enum: ['ideal'],
      });
      assert.deepStrictEqual(result.properties.value, { type: 'number' });
    }
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });

  test('keyof Input & string in a declared answer is the names of the inputs', async () => {
    await using workspace = await analysisWorkspace('class-instance-', {
      'route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';

type NonEmpty<T> = readonly [T, ...T[]];

type Answer<Input> =
  | { status: 'calculated'; result: number }
  | { status: 'missing'; inputs: NonEmpty<keyof Input & string> };

interface KidneyInput {
  creatinine: number;
  weight: number;
}

declare function answer(): Answer<KidneyInput>;

export const app = new Hono();

/** @openapi getAnswer */
app.get('/answer', validate(() => ({})), (c) => {
  return c.json(answer());
});
`,
    });
    const { spec, body, resolve } = await analyzeBody(workspace, '/answer');

    const { consumerPath, files, diagnostics } = await typecheckClient(
      workspace,
      spec,
      `const answer = await client.request('GET /answer', {});
if (answer.status === 'missing') {
  const first: 'creatinine' | 'weight' = answer.inputs[0];
  // @ts-expect-error height is not an input of the kidney calculation.
  const height: 'height' = answer.inputs[0];
  void [first, height];
}
`,
    );

    const missing = body.anyOf
      .map(resolve)
      .find((member: any) => member.properties.status.enum[0] === 'missing');
    assert.deepStrictEqual(enumOf(resolve(missing.properties.inputs).items), [
      'creatinine',
      'weight',
    ]);
    assert.ok(files.includes(consumerPath));
    assert.deepStrictEqual(diagnostics, []);
  });
});
