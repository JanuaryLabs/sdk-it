import { test } from '@zukhruf/testing/node';
import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type ResponsesObject,
  type SchemaObject,
  isReferenceObject,
  isSchemaObject,
} from 'openapi3-ts/oas31';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace, typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const catalog = `import { defineErrorCatalog } from 'evlog';

export const billingErrors = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: {
    status: 402,
    message: 'Card declined',
    why: 'The issuer refused the charge',
    fix: 'Use another card',
  },
  QUOTA: {
    status: 429,
    message: (params: { limit: number }) => \`Limit \${params.limit} reached\`,
  },
  UNKNOWN: { status: 500, message: 'Something failed' },
});
`;

/** An app.onError that sends evlog's own JSON for an EvlogError, as `JSON.stringify` writes it. */
const sendsEvlogJson = `app.onError((error) => {
  if (error instanceof EvlogError) {
    return new Response(JSON.stringify(error), {
      status: error.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw error;
});`;

/** An app.onError that sends the app's own body for an EvlogError. */
const sendsOwnBody = `app.onError((error, c) => {
  if (error instanceof EvlogError) {
    return c.json(
      { error: error.message, cause: { code: error.code, detail: error.why } },
      error.status,
    );
  }
  throw error;
});`;

/** The billing app, with `onError` registered after the app, or no error handler when it is empty. */
function route(onError: string) {
  return `import { Hono } from 'hono';
import { z } from 'zod';
import { EvlogError } from 'evlog';
import { validate } from '@sdk-it/hono/runtime';
import { billingErrors } from './catalog.ts';

function plainError() {
  return new Error('not a catalog error');
}

export const app = new Hono();
${onError}

/** @openapi pay */
app.post('/pay', validate((payload) => ({
  mode: { select: payload.query.mode, against: z.string() },
})), (c) => {
  const mode = c.var.input.mode;
  if (mode === 'declined') throw billingErrors.PAYMENT_DECLINED();
  if (mode === 'quota') throw billingErrors.QUOTA({ limit: 3 });
  if (mode === 'unknown') throw billingErrors.UNKNOWN();
  if (mode === 'override') throw billingErrors.PAYMENT_DECLINED({ status: 409 });
  if (mode === 'alias') {
    const error = billingErrors.QUOTA({ limit: 5 });
    throw error;
  }
  if (mode === 'plain') throw plainError();
  return c.json({ ok: true });
});
`;
}

function workspace(onError: string, catalogSource = catalog) {
  return analysisWorkspace('evlog-', {
    'route.ts': route(onError),
    'catalog.ts': catalogSource,
  });
}

function jsonSchema(
  responses: ResponsesObject | undefined,
  status: string,
): SchemaObject {
  const response = responses?.[status];
  const schema =
    response && !isReferenceObject(response)
      ? response.content?.['application/json']?.schema
      : undefined;
  assert.ok(
    schema && isSchemaObject(schema),
    `HTTP ${status} must be documented as JSON`,
  );
  return schema;
}

void test('each catalog throw documents the response app.onError sends at the status its catalog entry gives, or the one its call overrides, with no preset', async () => {
  await using dir = await workspace(sendsEvlogJson);
  const { app }: { app: Hono } = await import(
    pathToFileURL(join(dir.path, 'route.ts')).href
  );
  const statuses: number[] = [];
  for (const mode of ['declined', 'quota', 'unknown', 'override', 'alias']) {
    const response = await app.request(`/pay?mode=${mode}`, { method: 'POST' });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [402, 429, 500, 409, 429]);

  using project = openAnalysisProject(dir.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  const responses = spec.paths['/pay']?.post?.responses;

  assert.deepEqual(
    Object.keys(responses ?? {}).sort(),
    ['200', '402', '409', '429', '500'],
    "each status the wire sends, and no 400 or 415: app.onError re-throws validate()'s HTTPException, so Hono sends none",
  );
  for (const status of ['402', '409', '429', '500']) {
    jsonSchema(responses, status);
  }
});

void test("app.onError's own body for a catalog throw documents each entry's code, message and why as consts, with no hand-written analyzer", async () => {
  await using dir = await workspace(sendsOwnBody);
  const { app }: { app: Hono } = await import(
    pathToFileURL(join(dir.path, 'route.ts')).href
  );
  const response = await app.request('/pay?mode=declined', { method: 'POST' });
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), {
    error: 'Card declined',
    cause: {
      code: 'billing.PAYMENT_DECLINED',
      detail: 'The issuer refused the charge',
    },
  });

  using project = openAnalysisProject(dir.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  const responses = spec.paths['/pay']?.post?.responses;

  const declined: SchemaObject = {
    type: 'object',
    properties: {
      cause: {
        type: 'object',
        properties: {
          code: { enum: ['billing.PAYMENT_DECLINED'], type: 'string' },
          detail: { enum: ['The issuer refused the charge'], type: 'string' },
        },
        required: ['code', 'detail'],
        additionalProperties: false,
      },
      error: { enum: ['Card declined'], type: 'string' },
    },
    required: ['cause', 'error'],
    additionalProperties: false,
  };
  assert.deepEqual(jsonSchema(responses, '402'), declined);
  assert.deepEqual(
    jsonSchema(responses, '409'),
    declined,
    "the overridden status keeps the entry's body",
  );
  const quota = jsonSchema(responses, '429');
  assert.deepEqual(
    quota.properties?.error,
    { type: 'string' },
    'the QUOTA message is built from the call',
  );
  const cause = quota.properties?.cause;
  assert.ok(cause && isSchemaObject(cause));
  assert.deepEqual(cause.properties?.code, {
    enum: ['billing.QUOTA'],
    type: 'string',
  });
  assert.deepEqual(
    cause.required,
    ['code'],
    'an entry with no why sends no detail, as JSON leaves out undefined',
  );

  const output = join(dir.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Billing', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    {
      output,
      name: 'Billing',
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
    `import type { BillingEndpoints } from './index.ts';
type PayError = BillingEndpoints['POST /pay']['error'];
declare const declined: Extract<PayError, { status: 402 }>;
const code: 'billing.PAYMENT_DECLINED' = declined.data.cause.code;
const message: 'Card declined' = declined.data.error;
// @ts-expect-error the 402 body carries only the declined code
const wrong: 'billing.QUOTA' = declined.data.cause.code;
void [code, message, wrong];
`,
  );
  const { files, diagnostics } = typecheck(configPath);
  assert.ok(files.includes(consumerPath));
  assert.deepEqual(diagnostics, []);
});

void test("a catalog entry with no status documents app.onError's response at evlog's default 500, since evlog sends status ?? entry.status ?? 500", async () => {
  await using dir = await workspace(
    sendsOwnBody,
    catalog.replace(
      "UNKNOWN: { status: 500, message: 'Something failed' }",
      "UNKNOWN: { message: 'Something failed' }",
    ),
  );
  const { app }: { app: Hono } = await import(
    pathToFileURL(join(dir.path, 'route.ts')).href
  );
  const response = await app.request('/pay?mode=unknown', { method: 'POST' });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Something failed',
    cause: { code: 'billing.UNKNOWN' },
  });

  using project = openAnalysisProject(dir.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });

  assert.deepEqual(jsonSchema(spec.paths['/pay']?.post?.responses, '500'), {
    type: 'object',
    properties: {
      cause: {
        type: 'object',
        properties: {
          code: { enum: ['billing.UNKNOWN'], type: 'string' },
          detail: { type: 'string' },
        },
        required: ['code'],
        additionalProperties: false,
      },
      error: { enum: ['Something failed'], type: 'string' },
    },
    required: ['cause', 'error'],
    additionalProperties: false,
  });
});

void test('a catalog throw in an app with no app.onError documents no response, since no analyzer reads it there', async () => {
  await using dir = await workspace('');

  using project = openAnalysisProject(dir.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });

  const statuses = Object.keys(spec.paths['/pay']?.post?.responses ?? {});
  assert.deepStrictEqual(
    statuses.toSorted(),
    ['200', '400', '415'],
    "only the route's own 200 and validate()'s 400 and 415 are documented; no catalog throw adds a status",
  );
});
