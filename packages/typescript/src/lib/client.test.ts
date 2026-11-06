import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { ServerObject } from 'openapi3-ts/oas31';

import { analysisWorkspace, workspaceDirectory } from '@sdk-it/testing';
import { generate, renderModule } from '@sdk-it/typescript';

/** The `servers` export of the SDK generated from a spec with `servers`. */
async function exportedServers(servers: ServerObject[]): Promise<unknown> {
  const { text } = await renderModule(
    {
      openapi: '3.1.0',
      info: { title: 'Hosts', version: '1.0.0' },
      servers,
      paths: {},
    },
    { name: 'Hosts' },
  );
  await using workspace = await analysisWorkspace('client-servers-', {
    'hosts.ts': text,
  });
  const sdk = await import(
    pathToFileURL(join(workspace.path, 'hosts.ts')).href
  );
  return sdk.servers;
}

describe('the servers a generated SDK exports', () => {
  test('passes through URLs without variables', async () => {
    const result = await exportedServers([{ url: 'https://api.example.com' }]);
    assert.deepStrictEqual(result, ['https://api.example.com']);
  });

  test('substitutes default when no enum', async () => {
    const result = await exportedServers([
      {
        url: 'https://{region}.api.example.com',
        variables: {
          region: { default: 'us' },
        },
      },
    ]);
    assert.deepStrictEqual(result, ['https://us.api.example.com']);
  });

  test('expands all enum values for a single variable', async () => {
    const result = await exportedServers([
      {
        url: 'https://{env}.api.example.com',
        variables: {
          env: { default: 'prod', enum: ['prod', 'staging', 'dev'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, [
      'https://prod.api.example.com',
      'https://staging.api.example.com',
      'https://dev.api.example.com',
    ]);
  });

  test('expands cartesian product of multiple variables', async () => {
    const result = await exportedServers([
      {
        url: 'https://{env}.api.example.com/v{version}',
        variables: {
          env: { default: 'prod', enum: ['prod', 'staging'] },
          version: { default: '1', enum: ['1', '2'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, [
      'https://prod.api.example.com/v1',
      'https://prod.api.example.com/v2',
      'https://staging.api.example.com/v1',
      'https://staging.api.example.com/v2',
    ]);
  });

  test('handles multiple servers', async () => {
    const result = await exportedServers([
      { url: 'https://api.example.com' },
      {
        url: 'https://{env}.api.other.com',
        variables: {
          env: { default: 'prod', enum: ['prod', 'staging'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, [
      'https://api.example.com',
      'https://prod.api.other.com',
      'https://staging.api.other.com',
    ]);
  });

  test('exports no servers for empty servers', async () => {
    const result = await exportedServers([]);
    assert.strictEqual(result, undefined);
  });

  test('falls back to default when enum is empty array', async () => {
    const result = await exportedServers([
      {
        url: 'https://{env}.api.example.com',
        variables: {
          env: { default: 'prod', enum: [] },
        },
      },
    ]);
    assert.deepStrictEqual(result, ['https://prod.api.example.com']);
  });

  test('replaces all occurrences when same variable appears multiple times', async () => {
    const result = await exportedServers([
      {
        url: 'https://{region}.api.{region}.example.com',
        variables: {
          region: { default: 'us', enum: ['us', 'eu'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, [
      'https://us.api.us.example.com',
      'https://eu.api.eu.example.com',
    ]);
  });

  test('ignores variables not referenced in URL', async () => {
    const result = await exportedServers([
      {
        url: 'https://api.example.com',
        variables: {
          unused: { default: 'value', enum: ['a', 'b'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, [
      'https://api.example.com',
      'https://api.example.com',
    ]);
  });

  test('keeps placeholder when variable is in URL but not defined', async () => {
    const result = await exportedServers([
      {
        url: 'https://{env}.api.example.com:{port}',
        variables: {
          env: { default: 'prod', enum: ['prod'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, ['https://prod.api.example.com:{port}']);
  });

  test('coerces numeric default to string', async () => {
    const result = await exportedServers([
      {
        url: 'https://api.example.com:{port}',
        variables: {
          port: { default: 8080 },
        },
      },
    ]);
    assert.deepStrictEqual(result, ['https://api.example.com:8080']);
  });

  test('expands cartesian product of three variables', async () => {
    const result = await exportedServers([
      {
        url: 'https://{env}.{region}.api.example.com/v{version}',
        variables: {
          env: { default: 'prod', enum: ['prod', 'staging'] },
          region: { default: 'us', enum: ['us', 'eu'] },
          version: { default: '1', enum: ['1', '2'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, [
      'https://prod.us.api.example.com/v1',
      'https://prod.us.api.example.com/v2',
      'https://prod.eu.api.example.com/v1',
      'https://prod.eu.api.example.com/v2',
      'https://staging.us.api.example.com/v1',
      'https://staging.us.api.example.com/v2',
      'https://staging.eu.api.example.com/v1',
      'https://staging.eu.api.example.com/v2',
    ]);
  });

  test('single enum value behaves like default-only', async () => {
    const result = await exportedServers([
      {
        url: 'https://{env}.api.example.com',
        variables: {
          env: { default: 'prod', enum: ['prod'] },
        },
      },
    ]);
    assert.deepStrictEqual(result, ['https://prod.api.example.com']);
  });
});

test('a generated client puts the signal passed to prepare in the prepared request', async () => {
  await using directory = await workspaceDirectory('client-prepare-signal-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Signals', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            tags: ['users'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
            },
          },
        },
      },
    },
    { output: directory.path, name: 'Signals', readme: false },
  );
  const { createSignals } = await import(
    pathToFileURL(join(directory.path, 'client.ts')).href
  );
  const controller = new AbortController();

  const prepared = await createSignals({
    baseUrl: 'https://api.example.com',
  }).prepare('GET /users', {}, { signal: controller.signal });

  assert.equal(prepared.init.signal, controller.signal);
});
