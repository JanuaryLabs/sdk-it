import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import backend from './client.ts';
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
