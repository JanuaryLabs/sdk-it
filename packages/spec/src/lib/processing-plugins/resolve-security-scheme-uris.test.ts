import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { OpenAPIDocument } from '@sdk-it/core';
import {
  loadSpec,
  normalizeSecurity,
  processSpec,
  resolveSecuritySchemeUris,
} from '@sdk-it/spec';

function specWith(
  requirement: string,
  extras: Partial<OpenAPIDocument> = {},
): OpenAPIDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'External security', version: '1.0.0' },
    paths: {
      '/records': {
        get: {
          operationId: 'getRecords',
          security: [{ [requirement]: [] }],
          responses: { '204': { description: 'OK' } },
        },
      },
    },
    ...extras,
  };
}

test('resolves a same-document security scheme pointer to its registered name', async () => {
  const { spec, diagnostics } = await processSpec({
    spec: specWith('#/components/securitySchemes/bearer', {
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      },
    }),
    plugins: [resolveSecuritySchemeUris(), normalizeSecurity()],
  });

  assert.deepStrictEqual(spec.paths['/records']?.get?.security, [
    { bearer: [] },
  ]);
  assert.deepStrictEqual(Object.keys(spec.components.securitySchemes), [
    'bearer',
  ]);
  assert.deepStrictEqual(diagnostics, []);
});

test('resolves a relative security scheme URI against the document $self', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resolve-scheme-uri-'));
  try {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          },
        },
      }),
    );

    const { spec, diagnostics } = await processSpec({
      spec: specWith('./auth.json#/components/securitySchemes/apiKey', {
        $self: pathToFileURL(join(directory, 'openapi.json')).href,
      }),
      plugins: [resolveSecuritySchemeUris(), normalizeSecurity()],
    });

    assert.deepStrictEqual(spec.components.securitySchemes, {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    });
    assert.deepStrictEqual(spec.paths['/records']?.get?.security, [
      { apiKey: [] },
    ]);
    assert.deepStrictEqual(diagnostics, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('resolves an absolute security scheme URI over http', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string) => {
    requested.push(String(input));
    return {
      ok: true,
      json: async () => ({
        components: {
          securitySchemes: { oauth: { type: 'http', scheme: 'bearer' } },
        },
      }),
    };
  }) as never;
  try {
    const { spec, diagnostics } = await processSpec({
      spec: specWith(
        'https://auth.example.com/schemes.json#/components/securitySchemes/oauth',
      ),
      plugins: [resolveSecuritySchemeUris(), normalizeSecurity()],
    });

    assert.deepStrictEqual(requested, [
      'https://auth.example.com/schemes.json',
    ]);
    assert.deepStrictEqual(spec.components.securitySchemes, {
      oauth: { type: 'http', scheme: 'bearer' },
    });
    assert.deepStrictEqual(spec.paths['/records']?.get?.security, [
      { oauth: [] },
    ]);
    assert.deepStrictEqual(diagnostics, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetches each referenced document once when several schemes share it', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        components: {
          securitySchemes: {
            reader: { type: 'apiKey', in: 'header', name: 'X-Reader' },
            writer: { type: 'apiKey', in: 'header', name: 'X-Writer' },
          },
        },
      }),
    };
  }) as never;
  try {
    const base = 'https://auth.example.com/schemes.json';
    const { spec } = await processSpec({
      spec: specWith(`${base}#/components/securitySchemes/reader`, {
        security: [{ [`${base}#/components/securitySchemes/writer`]: [] }],
      }),
      plugins: [resolveSecuritySchemeUris()],
    });

    assert.equal(calls, 1);
    assert.deepStrictEqual(
      Object.keys(spec.components.securitySchemes).sort(),
      ['reader', 'writer'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports the URI that failed and leaves the requirement unresolved', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resolve-scheme-uri-'));
  try {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({}));

    const { spec, diagnostics } = await processSpec({
      spec: specWith('./auth.json#/components/securitySchemes/missing', {
        $self: pathToFileURL(join(directory, 'openapi.json')).href,
      }),
      plugins: [resolveSecuritySchemeUris(), normalizeSecurity()],
    });

    assert.deepStrictEqual(
      diagnostics.map(({ code, plugin }) => ({ code, plugin })),
      [
        {
          code: 'unresolvable-security-scheme-uri',
          plugin: 'resolve-security-scheme-uris',
        },
        {
          code: 'unresolved-security-scheme',
          plugin: 'normalize-security',
        },
      ],
    );
    assert.deepStrictEqual(spec.components.securitySchemes, {});
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('treats a bare component-shaped name as a name, never as a document', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    assert.fail('must not fetch a plain name')) as never;
  try {
    const { diagnostics } = await processSpec({
      spec: specWith('auth.json'),
      plugins: [resolveSecuritySchemeUris(), normalizeSecurity()],
    });

    assert.deepStrictEqual(
      diagnostics.map(({ code }) => code),
      ['unresolved-security-scheme'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadSpec stamps $self so a relative URI has a base to resolve against', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resolve-scheme-uri-'));
  try {
    const location = join(directory, 'openapi.json');
    writeFileSync(location, JSON.stringify(specWith('bearer')));

    const spec = (await loadSpec(location)) as OpenAPIDocument;

    assert.equal(spec.$self, pathToFileURL(location).href);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
