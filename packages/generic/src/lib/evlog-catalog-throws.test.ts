import { test } from '@zukhruf/testing/node';
import type { Hono } from 'hono';
import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SchemaObject } from 'openapi3-ts/oas31';

import type { NaunceResponseAnalyzer } from '@sdk-it/core';
import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { catalogError, evlogErrors } from '@sdk-it/hono/evlog';
import { typecheck } from '@sdk-it/testing';
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
  UNKNOWN: { message: 'Something failed' },
});
`;

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
app.onError((error, c) => {
  if (error instanceof EvlogError) {
    return new Response(JSON.stringify(${onError}), {
      status: error.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw error;
});

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

async function workspace(onError: string) {
  const dir = await mkdtempDisposable(
    join(fileURLToPath(new URL('../../../../', import.meta.url)), '.evlog-'),
  );
  await writeFile(join(dir.path, 'package.json'), '{"type":"module"}');
  await writeFile(
    join(dir.path, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ['route.ts', 'catalog.ts'],
    }),
  );
  await writeFile(join(dir.path, 'catalog.ts'), catalog);
  await writeFile(join(dir.path, 'route.ts'), route(onError));
  return dir;
}

function jsonSchema(
  responses: Record<string, unknown> | undefined,
  status: string,
): SchemaObject {
  const response = responses?.[status] as
    { content?: Record<string, { schema: SchemaObject }> } | undefined;
  const schema = response?.content?.['application/json']?.schema;
  assert.ok(schema, `HTTP ${status} must be documented as JSON`);
  return schema;
}

void test("evlogErrors documents each catalog throw at its status with evlog's wire shape", async () => {
  await using dir = await workspace('error');
  const { app } = (await import(
    pathToFileURL(join(dir.path, 'route.ts')).href
  )) as { app: Hono };
  const wire: Record<
    string,
    { status: number; body: Record<string, unknown> }
  > = {};
  for (const mode of ['declined', 'quota', 'unknown', 'override']) {
    const response = await app.request(`/pay?mode=${mode}`, { method: 'POST' });
    wire[mode] = { status: response.status, body: await response.json() };
  }
  assert.deepEqual(
    Object.values(wire).map(({ status }) => status),
    [402, 429, 500, 409],
  );
  assert.deepEqual(wire.declined.body, {
    name: 'EvlogError',
    message: 'Card declined',
    status: 402,
    data: {
      code: 'billing.PAYMENT_DECLINED',
      why: 'The issuer refused the charge',
      fix: 'Use another card',
    },
  });

  using project = openAnalysisProject(join(dir.path, 'tsconfig.json'));
  const spec = await analyze(project, {
    responseAnalyzer: { ...responseAnalyzer, ...evlogErrors },
  });
  const responses = spec.paths['/pay']?.post?.responses;

  for (const [mode, code] of [
    ['declined', 'billing.PAYMENT_DECLINED'],
    ['quota', 'billing.QUOTA'],
    ['unknown', 'billing.UNKNOWN'],
    ['override', 'billing.PAYMENT_DECLINED'],
  ] as const) {
    const { status, body } = wire[mode];
    const schema = jsonSchema(responses, String(status));
    assert.deepEqual(schema.properties?.status, {
      type: 'number',
      enum: [status],
    });
    const data = schema.properties?.data as SchemaObject;
    assert.deepEqual(data.properties?.code, { type: 'string', enum: [code] });
    for (const key of Object.keys(body)) {
      assert.ok(
        key in (schema.properties ?? {}),
        `${mode}: ${key} is documented`,
      );
    }
    for (const key of schema.required ?? []) {
      assert.ok(key in body, `${mode}: required ${key} is on the wire`);
    }
  }

  const output = join(dir.path, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Billing', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
    { output, name: 'Billing', readme: false, mode: 'full' },
  );
  const configPath = join(output, 'tsconfig.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.compilerOptions.strict = true;
  await writeFile(configPath, JSON.stringify(config));
  const consumerPath = join(output, 'src', 'consumer.ts');
  await writeFile(
    consumerPath,
    `import type { Endpoints } from './index.ts';
type PayError = Endpoints['POST /pay']['error'];
declare const declined: Extract<PayError, { status: 402 }>;
const code: 'billing.PAYMENT_DECLINED' = declined.data.data.code;
const message: string = declined.data.message;
// @ts-expect-error the 402 body carries only the declined code
const wrong: 'billing.QUOTA' = declined.data.data.code;
void [code, message, wrong];
`,
  );
  const { files, diagnostics } = typecheck(configPath);
  assert.ok(files.includes(consumerPath));
  assert.deepEqual(diagnostics, []);
});

void test('an app documents its own error body for catalog throws with catalogError', async () => {
  await using dir = await workspace(
    '{ error: error.message, cause: { code: error.code, detail: error.why } }',
  );
  const { app } = (await import(
    pathToFileURL(join(dir.path, 'route.ts')).href
  )) as { app: Hono };
  const response = await app.request('/pay?mode=declined', { method: 'POST' });
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), {
    error: 'Card declined',
    cause: {
      code: 'billing.PAYMENT_DECLINED',
      detail: 'The issuer refused the charge',
    },
  });
  const custom: NaunceResponseAnalyzer = {
    'throw.call.EvlogError': (_handler, deriver, node) => {
      const entry = catalogError(deriver, node);
      if (!entry) return [];
      return [
        {
          statusCode: String(entry.status),
          contentType: 'application/json',
          headers: [],
          schema: {
            type: 'object',
            required: ['error', 'cause'],
            properties: {
              error: { type: 'string' },
              cause: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string', enum: [entry.code] },
                  detail: { type: 'string' },
                },
              },
            },
          },
        },
      ];
    },
  };

  using project = openAnalysisProject(join(dir.path, 'tsconfig.json'));
  const spec = await analyze(project, {
    responseAnalyzer: { ...responseAnalyzer, ...custom },
  });

  assert.deepEqual(jsonSchema(spec.paths['/pay']?.post?.responses, '402'), {
    type: 'object',
    required: ['error', 'cause'],
    properties: {
      error: { type: 'string' },
      cause: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', enum: ['billing.PAYMENT_DECLINED'] },
          detail: { type: 'string' },
        },
      },
    },
  });
});

void test('a thrown call with no registered analyzer documents no response', async () => {
  await using dir = await workspace('error');

  using project = openAnalysisProject(join(dir.path, 'tsconfig.json'));
  const spec = await analyze(project, { responseAnalyzer });

  const statuses = Object.keys(spec.paths['/pay']?.post?.responses ?? {});
  for (const status of ['402', '409', '429', '500']) {
    assert.ok(!statuses.includes(status), `HTTP ${status} is not documented`);
  }
});
