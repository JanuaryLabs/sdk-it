import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import backend from './client.ts';
import { expandServerUrls } from './server-urls.ts';
import type { Spec } from './sdk.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../../test/fixtures/client');
const UPDATE_GOLDEN = process.env['UPDATE_GOLDEN'] === '1';

async function assertMatchesGolden(name: string, actual: string) {
  const goldenPath = join(fixturesDir, `${name}.txt`);

  if (UPDATE_GOLDEN) {
    await mkdir(dirname(goldenPath), { recursive: true });
    await writeFile(goldenPath, actual);
    return;
  }

  const expected = await readFile(goldenPath, 'utf-8');
  assert.strictEqual(actual, expected, `Golden file mismatch: ${name}`);
}

describe('expandServerUrls', () => {
  test('passes through URLs without variables', () => {
    const result = expandServerUrls([
      { url: 'https://api.example.com' },
    ]);
    assert.deepStrictEqual(result, ['https://api.example.com']);
  });

  test('substitutes default when no enum', () => {
    const result = expandServerUrls([
      {
        url: 'https://{region}.api.example.com',
        variables: {
          region: { default: 'us' },
        },
      },
    ]);
    assert.deepStrictEqual(result, ['https://us.api.example.com']);
  });

  test('expands all enum values for a single variable', () => {
    const result = expandServerUrls([
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

  test('expands cartesian product of multiple variables', () => {
    const result = expandServerUrls([
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

  test('handles multiple servers', () => {
    const result = expandServerUrls([
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

  test('returns empty array for empty servers', () => {
    const result = expandServerUrls([]);
    assert.deepStrictEqual(result, []);
  });

  test('falls back to default when enum is empty array', () => {
    const result = expandServerUrls([
      {
        url: 'https://{env}.api.example.com',
        variables: {
          env: { default: 'prod', enum: [] },
        },
      },
    ]);
    assert.deepStrictEqual(result, ['https://prod.api.example.com']);
  });
});

describe('client template', () => {
  test('basic client without servers or options', async () => {
    const spec: Omit<Spec, 'operations'> = {
      name: 'TestClient',
      servers: [],
      options: [],
      makeImport: (p) => p,
    };
    await assertMatchesGolden('basic', backend(spec));
  });

  test('client with server URLs', async () => {
    const spec: Omit<Spec, 'operations'> = {
      name: 'ApiClient',
      servers: ['https://api.example.com', 'https://staging.example.com'],
      options: [],
      makeImport: (p) => p,
    };
    await assertMatchesGolden('with-servers', backend(spec));
  });

  test('client with token option', async () => {
    const spec: Omit<Spec, 'operations'> = {
      name: 'AuthClient',
      servers: [],
      options: [
        {
          name: 'Authorization',
          in: 'header',
          'x-optionName': 'token',
          schema: { type: 'string' },
          required: false,
        },
      ],
      makeImport: (p) => p,
    };
    await assertMatchesGolden('with-token', backend(spec));
  });

  test('client with api key header', async () => {
    const spec: Omit<Spec, 'operations'> = {
      name: 'ApiKeyClient',
      servers: [],
      options: [
        {
          name: 'x-api-key',
          in: 'header',
          schema: { type: 'string' },
          required: true,
        },
      ],
      makeImport: (p) => p,
    };
    await assertMatchesGolden('with-api-key', backend(spec));
  });

  test('client with input option', async () => {
    const spec: Omit<Spec, 'operations'> = {
      name: 'InputClient',
      servers: [],
      options: [
        {
          name: 'organizationId',
          in: 'input',
          schema: { type: 'string' },
          required: false,
        },
      ],
      makeImport: (p) => p,
    };
    await assertMatchesGolden('with-input-option', backend(spec));
  });

  test('client with server URL variables expanded', async () => {
    const spec: Omit<Spec, 'operations'> = {
      name: 'ApiClient',
      servers: expandServerUrls([
        {
          url: 'https://{environment}.api.example.com/v{version}',
          variables: {
            environment: {
              default: 'production',
              enum: ['production', 'staging'],
            },
            version: {
              default: '1',
              enum: ['1', '2'],
            },
          },
        },
      ]),
      options: [],
      makeImport: (p) => p,
    };
    await assertMatchesGolden('with-server-variables', backend(spec));
  });

  test('client with multiple options', async () => {
    const spec: Omit<Spec, 'operations'> = {
      name: 'FullClient',
      servers: ['https://api.example.com'],
      options: [
        {
          name: 'Authorization',
          in: 'header',
          'x-optionName': 'token',
          schema: { type: 'string' },
          required: false,
        },
        {
          name: 'x-api-key',
          in: 'header',
          schema: { type: 'string' },
          required: true,
        },
      ],
      makeImport: (p) => p,
    };
    await assertMatchesGolden('with-multiple-options', backend(spec));
  });
});
