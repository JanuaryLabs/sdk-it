import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { typecheck } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

const routes = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/**
 * @openapi updateSchedule
 * @tags schedules
 */
app.patch('/schedules/:taskId', validate('application/json', (payload) => ({
  taskId: { select: payload.params.taskId, against: z.string() },
  body: {
    select: payload.body,
    against: z.object({ name: z.string(), cron: z.string().optional() }),
  },
})), (c) => {
  return c.json({ name: c.var.input.body.name });
});

/**
 * @openapi createSchedule
 * @tags schedules
 */
app.post('/schedules', validate('application/json', (payload) => ({
  body: { select: payload.body, against: z.object({ name: z.string() }) },
  idempotencyKey: {
    select: payload.headers['idempotency-key'],
    against: z.string(),
  },
})), (c) => {
  return c.json({ name: c.var.input.body.name });
});

/**
 * @openapi writeLogs
 * @tags logs
 */
app.post('/logs', validate('application/json', (payload) => ({
  batch: {
    select: payload.body,
    against: z.array(z.object({ level: z.string(), message: z.string() })),
  },
})), (c) => {
  return c.json({ count: c.var.input.batch.length });
});
`;

async function workspace() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-whole-body-')),
  );
  const require = createRequire(import.meta.url);
  await symlink(
    dirname(dirname(require.resolve('zod/package.json'))),
    join(dir, 'node_modules'),
    'dir',
  );
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
      },
      include: ['route.ts'],
    }),
  );
  await writeFile(join(dir, 'route.ts'), routes);
  return dir;
}

async function generateClient(dir: string) {
  using project = openAnalysisProject(join(dir, 'tsconfig.json'));
  const { paths, components } = await analyze(project, { responseAnalyzer });
  const output = join(dir, 'client');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Schedules', version: '1.0.0' },
      paths,
      components,
    },
    { output, name: 'Schedules', readme: false, mode: 'full' },
  );
  return output;
}

test('a whole-body selection documents the selected schema as the request body', async () => {
  const dir = await workspace();
  try {
    using project = openAnalysisProject(join(dir, 'tsconfig.json'));
    const { paths } = JSON.parse(
      JSON.stringify(await analyze(project, { responseAnalyzer })),
    );

    const update = paths['/schedules/{taskId}'].patch;
    assert.deepStrictEqual(update.parameters, [
      {
        in: 'path',
        name: 'taskId',
        required: true,
        schema: { type: 'string' },
      },
    ]);
    assert.deepStrictEqual(update.requestBody, {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              cron: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
    });

    assert.deepStrictEqual(paths['/logs'].post.requestBody, {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                level: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['level', 'message'],
              additionalProperties: false,
            },
          },
        },
      },
    });

    assert.deepStrictEqual(paths['/schedules'].post.parameters, [
      {
        in: 'header',
        name: 'idempotency-key',
        required: true,
        schema: { type: 'string' },
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the generated client takes a whole-body selection as its body fields, or $body for an array', async () => {
  const dir = await workspace();
  try {
    const output = await generateClient(dir);
    const configPath = join(output, 'tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.strict = true;
    await writeFile(configPath, JSON.stringify(config));
    const consumerPath = join(output, 'src', 'consumer.ts');
    await writeFile(
      consumerPath,
      `import { Schedules } from './index.ts';
const client = new Schedules({ baseUrl: 'https://example.test' });
await client.request('PATCH /schedules/{taskId}', { taskId: 't1', name: 'nightly' });
await client.request('PATCH /schedules/{taskId}', {
  taskId: 't1', name: 'nightly', cron: '0 0 * * *',
});
// @ts-expect-error name is required by the body schema.
await client.request('PATCH /schedules/{taskId}', { taskId: 't1' });
await client.request('POST /schedules', { name: 'nightly', 'idempotency-key': 'k1' });
// @ts-expect-error the idempotency-key header is required.
await client.request('POST /schedules', { name: 'nightly' });
await client.request('POST /logs', { $body: [{ level: 'info', message: 'hi' }] });
// @ts-expect-error each log entry needs a message.
await client.request('POST /logs', { $body: [{ level: 'info' }] });
`,
    );

    const { files, diagnostics } = typecheck(configPath);

    assert.ok(files.includes(consumerPath));
    assert.deepEqual(diagnostics, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the generated client sends a whole-body selection as the request body', async () => {
  const dir = await workspace();
  try {
    const output = await generateClient(dir);
    const { Schedules } = await import(
      pathToFileURL(join(output, 'src/index.ts')).href
    );
    const requests: Request[] = [];
    const client = new Schedules({
      baseUrl: 'https://example.test',
      fetch: async (request: Request) => {
        requests.push(request.clone());
        return Response.json({ name: 'nightly', count: 1 });
      },
    });

    await client.request('PATCH /schedules/{taskId}', {
      taskId: 't1',
      name: 'nightly',
    });
    await client.request('POST /schedules', {
      name: 'nightly',
      'idempotency-key': 'k1',
    });
    await client.request('POST /logs', {
      $body: [{ level: 'info', message: 'hi' }],
    });

    const [update, create, logs] = requests;
    assert.equal(update.url, 'https://example.test/schedules/t1');
    assert.deepEqual(await update.json(), { name: 'nightly' });
    assert.equal(create.headers.get('idempotency-key'), 'k1');
    assert.deepEqual(await create.json(), { name: 'nightly' });
    assert.deepEqual(await logs.json(), [{ level: 'info', message: 'hi' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
